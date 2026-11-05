// The dock's six elements. A page is reached directly (`to`) or through a group (`items`) that unfolds above it. Every page of the
// app is in here exactly once (a test compares it with the route list), so none can be unreachable.
const page = (to, label, tile) => ({ to, label, tile });

export const DOCK = [
  { id: "home", label: "Home", tile: "home", to: "/" },
  { id: "money", label: "Money", tile: "money", items: [page("/money", "Money", "money"), page("/people", "People", "people")] },
  { id: "food", label: "Food", tile: "food", items: [page("/groceries", "Groceries", "groceries"), page("/nutrition", "Nutrition", "nutrition")] },
  { id: "body", label: "Body", tile: "bodygroup", items: [page("/fitness", "Fitness", "fitness"), page("/body", "Body", "body")] },
  { id: "plan", label: "Plan", tile: "plan", items: [page("/tasks", "Tasks", "tasks"), page("/calendar", "Calendar", "calendar")] },
  { id: "settings", label: "Settings", tile: "settings", to: "/settings" },
];

export const DOCK_PAGES = DOCK.flatMap((e) => (e.items ? e.items : [e]));

/** Is this address inside the page `to`? (Home is only the dashboard itself.) */
export const inPage = (pathname, to) => (to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`));
