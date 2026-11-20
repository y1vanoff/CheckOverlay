//! Keep Windows non-client painting out of the transparent WebView surface.
#[cfg(windows)]
mod windows {
 use windows_sys::Win32::{Foundation::{HWND, LPARAM, LRESULT, WPARAM}, Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_NCRENDERING_POLICY, DWMNCRP_DISABLED}, UI::WindowsAndMessaging::{WM_NCPAINT, WM_NCACTIVATE, WM_NCDESTROY}};
 type SubclassProc = unsafe extern "system" fn(HWND,u32,WPARAM,LPARAM,usize,usize)->LRESULT;
 #[link(name="comctl32")]
 extern "system" {
  fn SetWindowSubclass(hwnd:HWND,callback:Option<SubclassProc>,id:usize,data:usize)->i32;
  fn RemoveWindowSubclass(hwnd:HWND,callback:Option<SubclassProc>,id:usize)->i32;
  fn DefSubclassProc(hwnd:HWND,message:u32,wparam:WPARAM,lparam:LPARAM)->LRESULT;
 }
 const FRAME_SUBCLASS:usize=0x434f;
 unsafe extern "system" fn frame_proc(hwnd:HWND,message:u32,wparam:WPARAM,lparam:LPARAM,id:usize,_data:usize)->LRESULT {
  match message {
   WM_NCPAINT=>0,
   // Keep activation processing, but prohibit painting the native caption/border.
   WM_NCACTIVATE=>DefSubclassProc(hwnd,message,wparam,-1),
   WM_NCDESTROY=>{RemoveWindowSubclass(hwnd,Some(frame_proc),id);DefSubclassProc(hwnd,message,wparam,lparam)},
   _=>DefSubclassProc(hwnd,message,wparam,lparam),
  }
 }
 // Must run on the window's owning UI thread (Tauri setup).
 pub fn install(hwnd:HWND)->Result<(),String>{
  let policy=DWMNCRP_DISABLED;
  let hr=unsafe{DwmSetWindowAttribute(hwnd,DWMWA_NCRENDERING_POLICY,&policy as *const _ as _,std::mem::size_of_val(&policy) as u32)};
  if hr<0{return Err(format!("Не удалось отключить системную рамку: {hr:#x}"));}
  if unsafe{SetWindowSubclass(hwnd,Some(frame_proc),FRAME_SUBCLASS,0)}==0{return Err("Не удалось отключить системную отрисовку рамки".into());}
  Ok(())
 }
 #[cfg(test)]
 mod tests {
  use super::*;
  use windows_sys::Win32::{Graphics::Dwm::{DwmGetWindowAttribute,DWMWA_NCRENDERING_ENABLED},UI::WindowsAndMessaging::*};
  #[test]
  fn native_frame_stays_disabled_across_activation_changes(){
   let class:Vec<u16>="STATIC\0".encode_utf16().collect();
   let title:Vec<u16>="frame test\0".encode_utf16().collect();
   unsafe{
    let hwnd=CreateWindowExW(0,class.as_ptr(),title.as_ptr(),WS_OVERLAPPEDWINDOW,0,0,100,100,std::ptr::null_mut(),std::ptr::null_mut(),std::ptr::null_mut(),std::ptr::null());
    assert!(!hwnd.is_null());
    install(hwnd).unwrap();
    for active in [0,1,0,1] {
     assert_ne!(SendMessageW(hwnd,WM_NCACTIVATE,active,0),0);
     assert_eq!(SendMessageW(hwnd,WM_NCPAINT,1,0),0);
     let mut enabled:i32=1;
     assert!(DwmGetWindowAttribute(hwnd,DWMWA_NCRENDERING_ENABLED,&mut enabled as *mut _ as _,4)>=0);
     assert_eq!(enabled,0);
    }
    // Unrelated messages still reach the original procedure.
    assert_eq!(SendMessageW(hwnd,WM_GETTEXTLENGTH,0,0),10);
    assert_ne!(DestroyWindow(hwnd),0);
   }
  }
 }
}
#[cfg(windows)]
pub use windows::install;
