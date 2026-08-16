import { Marquee } from "@meridian/ui/components/marquee";

const INSTITUTIONS = [
  "Chase",
  "Fidelity",
  "Vanguard",
  "Coinbase",
  "Schwab",
  "Amex",
  "Robinhood",
  "Wise",
  "Ally",
  "Wealthfront",
  "Betterment",
  "Kraken",
];

function Pill({ name }: { name: string }) {
  return (
    <span className="border-border text-muted-foreground mx-1 inline-flex items-center rounded-md border bg-white/[0.02] px-4 py-2 font-mono text-sm whitespace-nowrap">
      {name}
    </span>
  );
}

export default function IntegrationsMarquee() {
  return (
    <div className="relative">
      <Marquee pauseOnHover className="[--duration:38s] py-1">
        {INSTITUTIONS.map((n) => (
          <Pill key={n} name={n} />
        ))}
      </Marquee>
      {/* edge fades */}
      <div className="from-background pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r to-transparent"></div>
      <div className="from-background pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l to-transparent"></div>
    </div>
  );
}
