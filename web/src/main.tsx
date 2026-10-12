import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { watchViewportHeight } from "./lib/viewport.ts";
import "./styles/app.css";

/**
 * `#pair=<code>` from the settings page's QR. A fragment never reaches the server and must
 * not stay in the address bar (or be mistaken for a session route), so it is taken out here
 * and handed to the pairing screen.
 */
const scanned = /^#pair=([0-9]{6})$/.exec(location.hash)?.[1];
if (scanned) history.replaceState(null, "", `${location.pathname}${location.search}`);

// Phones only: keeps the composer above the software keyboard (see viewport.ts).
watchViewportHeight();

createRoot(document.getElementById("root") as HTMLElement).render(<App pairCode={scanned} />);
