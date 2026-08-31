"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { SessionUser } from "../../packages/contracts/src";
import { post } from "../../lib/client/api";
import { Brand, Initials } from "./Brand";

export function CasinoNav({ user, tableName, inviteCode }: { user?: SessionUser | null; tableName?: string; inviteCode?: string | null }) {
  const router = useRouter(); const pathname = usePathname();
  return <header className="casino-nav">
    <Brand />
    {tableName ? <div className="nav-table-id"><span className="live-dot"/><b>{tableName}</b>{inviteCode && <span>{inviteCode}</span>}</div> : <nav className="main-links" aria-label="Main navigation"><Link className={pathname === "/lobby" ? "active" : ""} href="/lobby">Lobby</Link><Link href="/history">History</Link><Link href="/rules">How to play</Link></nav>}
    <div className="nav-account"><span className="play-money-note">PLAY MONEY ONLY</span>{user && <><Link href="/profile" className="balance-badge"><span className="coin-dot">$</span><b>${user.balance.toLocaleString()}</b></Link><button className="avatar-button" onClick={() => router.push("/settings")} aria-label="Open settings"><Initials name={user.displayName}/></button><button className="quiet-button nav-signout" onClick={async()=>{await post("auth/logout",{});router.replace("/")}}>Sign out</button></>}</div>
  </header>;
}
