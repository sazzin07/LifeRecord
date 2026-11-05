/* Sets the theme class on <html> before the first paint, so a light-theme visitor never sees a flash of dark.
   Same rule as the settings provider (src/context/SettingsContext.jsx): the saved choice is "light", "dark" or "system"
   (stored as JSON under lm_theme); no saved choice means "system". Loaded as an external same-origin script because the
   Content-Security-Policy allows only script-src 'self'. */
(function () {
  var root = document.documentElement;
  var choice = "system";
  try {
    var raw = window.localStorage.getItem("lm_theme");
    if (raw !== null) choice = JSON.parse(raw);
  } catch (e) { /* storage unavailable: follow the device */ }
  var dark = choice === "dark" || (choice !== "light" && !!window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  if (dark) root.classList.add("dark"); else root.classList.remove("dark");
})();
