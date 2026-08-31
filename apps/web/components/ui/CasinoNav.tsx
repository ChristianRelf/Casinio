"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { post } from "../../lib/client/api";
import type { SessionUser } from "../../packages/contracts/src";
import { Brand, Initials } from "./Brand";

const formatBalance = (value: number) => Number(value).toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(Number(value)) ? 0 : 2, maximumFractionDigits: 2 });

function AnimatedBalance({ value }: { value: number }) {
  const [display, setDisplay] = useState(value); const current = useRef(value);
  useEffect(() => {
    let reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    try { reduce ||= Boolean(JSON.parse(localStorage.getItem("ls_preferences") ?? "{}").reducedMotion); } catch { /* Ignore invalid local settings. */ }
    if (reduce) { current.current = value; setDisplay(value); return; }
    const from = current.current; const started = performance.now(); let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / 480); const eased = 1 - Math.pow(1 - progress, 3);
      const next = Math.round((from + (value - from) * eased) * 100) / 100; current.current = next; setDisplay(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, [value]);
  return <b aria-label={`${formatBalance(value)} play dollars`}>${formatBalance(display)}</b>;
}

export function CasinoNav({ user, tableName, inviteCode }: { user?: SessionUser | null; tableName?: string; inviteCode?: string | null }) {
  const router = useRouter(); const pathname = usePathname();
  return <header className="casino-nav">
    <Brand />
    {tableName ? <div className="nav-table-id"><span className="live-dot" /><b>{tableName}</b>{inviteCode && <span>{inviteCode}</span>}</div> : <nav className="main-links" aria-label="Main navigation"><Link className={pathname === "/lobby" ? "active" : ""} href="/lobby">Lobby</Link><Link href="/history">History</Link><Link href="/rules">How to play</Link></nav>}
    <div className="nav-account"><span className="play-money-note">PLAY MONEY ONLY</span>{user && <><Link href="/profile" className="balance-badge"><span className="coin-dot">$</span><AnimatedBalance value={user.balance} /></Link><button className="avatar-button" onClick={() => router.push("/settings")} aria-label="Open settings"><Initials name={user.displayName} /></button><button className="quiet-button nav-signout" onClick={async () => { await post("auth/logout", {}); router.replace("/"); }}>Sign out</button></>}</div>
  </header>;
}
