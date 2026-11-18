#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use base64::{engine::general_purpose::STANDARD, Engine};
use image::{AnimationDecoder, ImageFormat};
use serde_json::Value;
use std::{fs::{self, File}, io::{Cursor, Write}, path::{Path, PathBuf}, sync::Mutex};
use tauri::{Emitter, Manager, menu::{CheckMenuItem, Menu, MenuItem}, tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState}};
use tauri_plugin_autostart::ManagerExt;
struct DiskLock(Mutex<()>);
fn dir(app: &tauri::AppHandle) -> Result<PathBuf,String> { let p=app.path().app_data_dir().map_err(|e|e.to_string())?;fs::create_dir_all(&p).map_err(|e|e.to_string())?;Ok(p) }
fn data_file(app: &tauri::AppHandle) -> Result<PathBuf,String>{Ok(dir(app)?.join("state.json"))}
fn error(e: impl std::fmt::Display)->String{e.to_string()}
#[tauri::command]
fn load_state(app:tauri::AppHandle)->Result<Option<Value>,String>{
 let p=data_file(&app)?;if !p.exists(){return Ok(None);}
 if fs::metadata(&p).map_err(error)?.len()>2_000_000{return Err("Файл данных слишком большой".into());}
 serde_json::from_slice(&fs::read(p).map_err(error)?).map(Some).map_err(error)
}
#[cfg(windows)]
fn replace(from:&Path,to:&Path)->Result<(),String>{
 use std::os::windows::ffi::OsStrExt;
 let a:Vec<u16>=from.as_os_str().encode_wide().chain(Some(0)).collect();let b:Vec<u16>=to.as_os_str().encode_wide().chain(Some(0)).collect();
 let ok=unsafe{windows_sys::Win32::Storage::FileSystem::MoveFileExW(a.as_ptr(),b.as_ptr(),windows_sys::Win32::Storage::FileSystem::MOVEFILE_REPLACE_EXISTING|windows_sys::Win32::Storage::FileSystem::MOVEFILE_WRITE_THROUGH)};
 if ok==0{Err(std::io::Error::last_os_error().to_string())}else{Ok(())}
}
#[cfg(not(windows))]
fn replace(from:&Path,to:&Path)->Result<(),String>{fs::rename(from,to).map_err(error)}
#[tauri::command]
fn save_state(app:tauri::AppHandle,value:Value,lock:tauri::State<DiskLock>)->Result<(),String>{
 let _guard=lock.0.lock().map_err(error)?;
 if value["version"]!=1||!value["tasks"].is_array(){return Err("Некорректные данные".into());}
 let bytes=serde_json::to_vec(&value).map_err(error)?;if bytes.len()>2_000_000{return Err("Файл данных слишком большой".into());}
 let target=data_file(&app)?;let temp=target.with_extension("tmp");{let mut file=File::create(&temp).map_err(error)?;file.write_all(&bytes).map_err(error)?;file.sync_all().map_err(error)?;}replace(&temp,&target)?;
 Ok(())
}
#[tauri::command]
fn archive_corrupt(app:tauri::AppHandle)->Result<(),String>{let p=data_file(&app)?;if p.exists(){fs::rename(&p,p.with_file_name(format!("state-corrupt-{}.json",uuid::Uuid::new_v4()))).map_err(error)?;}Ok(())}
#[tauri::command]
fn recover_state()->Result<Option<Value>,String>{
 let Some(path)=rfd::FileDialog::new().add_filter("Файл задач",&["json"]).pick_file() else{return Ok(None)};
 if fs::metadata(&path).map_err(error)?.len()>2_000_000{return Err("Файл слишком большой".into());}
 serde_json::from_slice(&fs::read(path).map_err(error)?).map(Some).map_err(error)
}
#[tauri::command]
fn autostart_enabled(app:tauri::AppHandle)->Result<bool,String>{app.autolaunch().is_enabled().map_err(error)}
#[tauri::command]
fn set_autostart(app:tauri::AppHandle,enabled:bool)->Result<(),String>{if enabled{app.autolaunch().enable().map_err(error)}else{app.autolaunch().disable().map_err(error)}}
#[tauri::command]
fn boot_id()->Result<String,String>{
 #[cfg(windows)]{
  #[repr(C)]struct BootEnvironment { guid:[u8;16],firmware:u32,flags:u64 }
  #[link(name="ntdll")] extern "system"{fn NtQuerySystemInformation(class:u32,info:*mut std::ffi::c_void,length:u32,returned:*mut u32)->i32;}
  let mut info=BootEnvironment{guid:[0;16],firmware:0,flags:0};
  let result=unsafe{NtQuerySystemInformation(90,&mut info as *mut _ as *mut _,std::mem::size_of::<BootEnvironment>() as u32,std::ptr::null_mut())};
  if result<0{return Err(format!("Не удалось прочитать BootIdentifier: {result:#x}"));}
  Ok(info.guid.iter().map(|v|format!("{v:02x}")).collect::<String>())
 }
 #[cfg(not(windows))]{Err("Поддерживается только Windows".into())}
}
fn check_image(bytes:&[u8])->Result<&'static str,String>{
 if bytes.len()>10*1024*1024{return Err("Изображение больше 10 МБ".into());}
 let format=image::guess_format(bytes).map_err(error)?;
 let ext=match format{ImageFormat::Png=>"png",ImageFormat::Jpeg=>"jpg",ImageFormat::Gif=>"gif",_=>return Err("Выберите PNG, JPG или GIF".into())};
 let (w,h)=image::ImageReader::with_format(Cursor::new(bytes),format).into_dimensions().map_err(error)?;
 if w==0||h==0||w>4096||h>4096{return Err("Максимальная сторона изображения — 4096 пикселей".into());}
 if format==ImageFormat::Gif{
  let decoder=image::codecs::gif::GifDecoder::new(Cursor::new(bytes)).map_err(error)?;
  let mut pixels=0u64;for (i,frame) in decoder.into_frames().enumerate(){if i>=300{return Err("Максимум 300 кадров GIF".into());}let f=frame.map_err(error)?;pixels+=f.buffer().width() as u64*f.buffer().height() as u64;if pixels>64_000_000{return Err("GIF слишком большой для компактной иконки".into());}}
 }else{image::load_from_memory_with_format(bytes,format).map_err(error)?;}
 Ok(ext)
}
#[tauri::command]
fn choose_image(app:tauri::AppHandle)->Result<Option<String>,String>{
 let Some(path)=rfd::FileDialog::new().add_filter("Изображение",&["png","jpg","jpeg","gif"]).pick_file() else{return Ok(None)};
 if fs::metadata(&path).map_err(error)?.len()>10*1024*1024{return Err("Максимум 10 МБ".into());}
 let bytes=fs::read(path).map_err(error)?;let ext=check_image(&bytes)?;let name=format!("icon-{}.{}",uuid::Uuid::new_v4(),ext);fs::write(dir(&app)?.join(&name),bytes).map_err(error)?;Ok(Some(name))
}
#[tauri::command]
fn read_icon(app:tauri::AppHandle,name:String,reduce_motion:bool)->Result<String,String>{
 if !name.starts_with("icon-")||name.len()>60||!name.chars().all(|c|c.is_ascii_hexdigit()||c=='-'||c=='.'||"iconjpg".contains(c)){return Err("Некорректное имя иконки".into());}
 let path=dir(&app)?.join(&name);if fs::metadata(&path).map_err(error)?.len()>10*1024*1024{return Err("Иконка слишком большая".into());}
 let bytes=fs::read(path).map_err(error)?;let ext=check_image(&bytes)?;
 if reduce_motion&&ext=="gif"{let image=image::load_from_memory(&bytes).map_err(error)?;let mut output=Cursor::new(Vec::new());image.write_to(&mut output,ImageFormat::Png).map_err(error)?;return Ok(format!("data:image/png;base64,{}",STANDARD.encode(output.into_inner())));}
 Ok(format!("data:image/{};base64,{}",if ext=="jpg"{"jpeg"}else{ext},STANDARD.encode(bytes)))
}
#[tauri::command]
fn set_material(app:tauri::AppHandle,compact:bool)->Result<(),String>{
 let w=app.get_webview_window("main").ok_or("Окно недоступно")?;
 #[cfg(windows)]{if compact{let _=window_vibrancy::clear_acrylic(&w);}else{let _=window_vibrancy::apply_acrylic(&w,Some((230,240,246,100)));}}
 Ok(())
}
#[tauri::command]
fn set_topmost(app:tauri::AppHandle,enabled:bool)->Result<(),String>{
 let w=app.get_webview_window("main").ok_or("Окно недоступно")?;w.set_always_on_top(enabled).map_err(error)?;
 if let Some(item)=app.menu().and_then(|m|m.get("topmost")){if let Some(check)=item.as_check_menuitem(){check.set_checked(enabled).map_err(error)?;}}
 Ok(())
}
#[tauri::command]
fn quit_app(app:tauri::AppHandle){app.exit(0);}
#[tauri::command]
fn popup_menu(app:tauri::AppHandle)->Result<(),String>{let window=app.get_webview_window("main").ok_or("Окно недоступно")?;let menu=app.menu().ok_or("Меню недоступно")?;window.popup_menu(&menu).map_err(error)}
fn main(){
 tauri::Builder::default()
  .plugin(tauri_plugin_single_instance::init(|app,_,_|{if let Some(w)=app.get_webview_window("main"){let _=w.show();let _=w.set_focus();let _=app.emit("app-action","show");}}))
  .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent,None))
  .manage(DiskLock(Mutex::new(())))
  .invoke_handler(tauri::generate_handler![load_state,save_state,archive_corrupt,recover_state,autostart_enabled,set_autostart,boot_id,choose_image,read_icon,set_material,set_topmost,quit_app,popup_menu])
  .on_window_event(|window,event|{if let tauri::WindowEvent::CloseRequested{api,..}=event{api.prevent_close();let _=window.emit("app-action","hide");}})
  .setup(|app|{
   let show=MenuItem::with_id(app,"show","Показать чеклист",true,None::<&str>)?;
   let compact=MenuItem::with_id(app,"compact","Компактный режим",true,None::<&str>)?;
   let settings=MenuItem::with_id(app,"settings","Настройки",true,None::<&str>)?;
   let pinned=app.get_webview_window("main").map(|w|w.is_always_on_top().unwrap_or(true)).unwrap_or(true);
   let top=CheckMenuItem::with_id(app,"topmost","Поверх остальных окон",true,pinned,None::<&str>)?;
   let quit=MenuItem::with_id(app,"quit","Выйти",true,None::<&str>)?;
   let menu=Menu::with_items(app,&[&show,&compact,&settings,&top,&quit])?;
   app.set_menu(menu.clone())?;if let Some(w)=app.get_webview_window("main"){let _=w.hide_menu();}
   let tray=TrayIconBuilder::new().tooltip("ЧекОверлей").icon(tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?).menu(&menu).show_menu_on_left_click(false)
    .on_menu_event(|app,event|{let _=app.emit("app-action",event.id().as_ref());})
    .on_tray_icon_event(|tray,event|{if matches!(event,TrayIconEvent::Click{button:MouseButton::Left,button_state:MouseButtonState::Up,..}){let app=tray.app_handle();if let Some(w)=app.get_webview_window("main"){let _=w.show();let _=w.set_focus();}let _=app.emit("app-action","show");}}).build(app)?;
   app.manage(tray);
   #[cfg(windows)]if let Some(w)=app.get_webview_window("main"){let _=window_vibrancy::apply_acrylic(&w,Some((230,240,246,100)));}
   Ok(())
  }).run(tauri::generate_context!()).expect("Не удалось запустить CheckOverlay");
}

#[cfg(test)]
mod tests {
 use super::*;
 #[test]
 #[cfg(windows)]
 fn windows_boot_guid_is_stable_and_nonzero(){let first=boot_id().unwrap();assert_eq!(first.len(),32);assert!(first.chars().any(|c|c!='0'));assert_eq!(first,boot_id().unwrap());}
 #[test]
 fn replacement_preserves_complete_json(){let folder=std::env::temp_dir().join(format!("checkoverlay-test-{}",uuid::Uuid::new_v4()));fs::create_dir(&folder).unwrap();let old=folder.join("state.json");let next=folder.join("state.tmp");fs::write(&old,b"old").unwrap();fs::write(&next,b"new").unwrap();replace(&next,&old).unwrap();assert_eq!(fs::read(&old).unwrap(),b"new");fs::remove_file(old).unwrap();fs::remove_dir(folder).unwrap();}
 #[test]
 fn image_validation_accepts_png_and_rejects_invalid(){assert_eq!(check_image(include_bytes!("../icons/32x32.png")).unwrap(),"png");assert!(check_image(b"not an image").is_err());}
}
