import type { Metadata } from "next";
import "@meridian/ui/global.css";
import Enhancements from "@/components/Enhancements";
import { appPath } from "@/lib/paths";

export const metadata: Metadata = {
  title: "Meridian — Orçamento",
  description: "Seu orçamento pessoal.",
  icons: { icon: appPath("/favicon.svg") },
  // The app is behind a login; keeping it out of the index costs nothing and
  // means the marketing site never competes with a page nobody can open.
  robots: { index: false, follow: false },
};

export const viewport = { themeColor: "#08080a" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="dark">
      <body>
        {/* Set before first paint so reveal targets start hidden without flashing.
            Inline and synchronous on purpose: this is the `.js` gate in
            global.css, and a React effect would run one paint too late — the
            panels would appear, then blink out, then fade back in.
            Kept as a script (rather than className="dark js" above) so that with
            JavaScript off the gate never applies and the content stays visible,
            which is the whole point of writing the rule that way. */}
        <script dangerouslySetInnerHTML={{ __html: 'document.documentElement.classList.add("js")' }} />
        {children}
        <Enhancements />
      </body>
    </html>
  );
}
