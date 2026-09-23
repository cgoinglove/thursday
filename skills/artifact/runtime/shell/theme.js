// Before the first paint. A page the app draws as a file's face (`?face`) is its content
// alone, on white like every face; any other opening takes the theme this browser last
// picked, if it picked one. The rest of the shell (shell.js) runs once the page is there.
(() => {
  const root = document.documentElement;
  if (/[?&]face\b/.test(location.search)) {
    root.classList.add("sh-face");
    root.dataset.theme = "light";
    return;
  }
  try {
    const theme = localStorage.getItem("thursday-shell-theme");
    if (theme === "light" || theme === "dark") root.dataset.theme = theme;
  } catch {}
})();
