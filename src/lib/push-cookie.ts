// httpOnly cookie holding this browser's Web-Push endpoint (set when push is
// enabled), so logout can delete that subscription and the previous user stops
// receiving this browser's notifications.
export const PUSH_ENDPOINT_COOKIE = 'cc_push_ep';
