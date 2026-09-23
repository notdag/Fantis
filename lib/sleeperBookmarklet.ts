// Builds the "Send Sleeper token to Fantis" bookmarklet — a one-click
// alternative to copying the authorization header out of DevTools.
//
// Runs on sleeper.com in the user's own browser. It looks for a JWT-shaped
// value in that page's localStorage/sessionStorage/cookies (Sleeper's web
// client has to keep its session somewhere the page can read), and if none
// is found it waits to catch the `authorization` header on the page's next
// fetch/XHR request. Either way the token is handed to Fantis in the URL
// FRAGMENT (`#token=...`) — fragments are never sent to any server, so
// Fantis's own server still never sees it. ConnectWriteAccess reads it,
// stores it in localStorage, and strips it from the address bar.
//
// Only the expiry/user_id check here is a sanity filter (unverified decode),
// same as lib/sleeperToken.ts — real validation happens when Sleeper
// accepts or rejects a mutation.

export function buildBookmarklet(fantisOrigin: string): string {
  const code = `(function(){
var O=${JSON.stringify(fantisOrigin)};
function ok(s){try{var p=s.split('.');if(p.length!==3)return false;var j=JSON.parse(atob(p[1].replace(/-/g,'+').replace(/_/g,'/')));return !!j.user_id&&j.exp*1000>Date.now()}catch(e){return false}}
function scan(t){var m=String(t||'').match(/eyJ[\\w-]+\\.eyJ[\\w-]+\\.[\\w-]+/g)||[];for(var i=0;i<m.length;i++){if(ok(m[i]))return m[i]}return null}
function url(t){return O+'/manager/lineups#token='+encodeURIComponent(t)}
var f=null;
try{var k=localStorage.getItem('token');if(k&&ok(k)){window.open(url(k),'_blank');return}}catch(e){}
try{[localStorage,sessionStorage].forEach(function(st){for(var i=0;i<st.length&&!f;i++){f=scan(st.getItem(st.key(i)))}})}catch(e){}
if(!f)f=scan(document.cookie);
if(f){window.open(url(f),'_blank');return}
var done=false;
function grab(a){if(done||!a||!ok(a))return;done=true;window.location.href=url(a)}
var of=window.fetch;
window.fetch=function(u,o){try{var h=(o&&o.headers)||(u&&u.headers);var a=h&&(typeof h.get==='function'?h.get('authorization'):(h.authorization||h.Authorization));grab(a)}catch(e){}return of.apply(this,arguments)};
var osr=XMLHttpRequest.prototype.setRequestHeader;
XMLHttpRequest.prototype.setRequestHeader=function(k,v){try{if(String(k).toLowerCase()==='authorization')grab(v)}catch(e){}return osr.apply(this,arguments)};
alert('Fantis: no saved Sleeper login found on this page yet.\\n\\nOpen any league or switch tabs inside Sleeper now - it will connect automatically the moment Sleeper makes its next request.');
})();`;
  return "javascript:" + encodeURIComponent(code.replace(/\n/g, ""));
}
