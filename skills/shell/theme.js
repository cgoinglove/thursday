// Before the first paint: the theme this browser picked last time, if any. The rest of
// the shell (shell.js) runs after the page is there.
try {
  const theme = localStorage.getItem("thursday-shell-theme");
  if (theme) document.documentElement.dataset.theme = theme;
} catch {}
