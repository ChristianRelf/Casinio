"use client";

import { FormEvent, useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { api, post } from "../../lib/client/api";
import { playSound } from "../../lib/client/sound";
import type { SessionUser } from "../../packages/contracts/src";
import { CasinoNav } from "../ui/CasinoNav";

type Overview = {
  user: SessionUser;
  wallet: { balance: number; last_refill_at: string | null };
  stats: { rounds_played: number; hands_won: number; hands_lost: number; hands_pushed: number; blackjacks: number; biggest_win: number; total_wagered: number };
};
type Preferences = { sound: boolean; effectsVolume: number; notificationVolume: number; shake: boolean; reducedMotion: boolean };
type AdminUser = { id: string; display_name: string; status: string; is_development: number; created_at: string; balance: number; rounds_played: number };

const defaultPreferences: Preferences = { sound: false, effectsVolume: 0.65, notificationVolume: 0.6, shake: true, reducedMotion: false };
const money = (value: number) => `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(Number(value)) ? 0 : 2, maximumFractionDigits: 2 })}`;

function useAccount() {
  const router = useRouter(); const [data, setData] = useState<Overview | null>(null); const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setData(await api<Overview>("me")); }
    catch (reason) { if ((reason as { status?: number }).status === 401) router.replace("/"); else setError(reason instanceof Error ? reason.message : "Account could not be loaded"); }
  }, [router]);
  useEffect(() => { void load(); }, [load]);
  return { data, error, load };
}

function PageFrame({ user, title, kicker, children }: { user: SessionUser; title: string; kicker: string; children: ReactNode }) {
  return <main className="support-screen"><CasinoNav user={user} /><div className="support-wrap"><header className="support-heading"><span className="overline">{kicker}</span><h1>{title}</h1></header>{children}</div></main>;
}

export function ProfilePage() {
  const { data, error, load } = useAccount(); const [message, setMessage] = useState("");
  if (!data) return <main className="loading-screen"><p>{error || "Loading profile…"}</p></main>;
  const stats = data.stats; const decisions = stats.hands_won + stats.hands_lost;
  const refill = async () => {
    try { const result = await post<{ amount: number }>("me/refill", {}); setMessage(`${money(result.amount)} in recovery play money was added.`); await load(); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "Recovery allowance is not available"); }
  };
  return <PageFrame user={{ ...data.user, balance: data.wallet.balance }} kicker="PLAYER PROFILE" title={data.user.displayName}>
    <section className="profile-grid">
      <article className="profile-balance"><span>PLAY-MONEY BALANCE</span><b>{money(data.wallet.balance)}</b><p>No cash value. No purchase history because there are no purchases.</p><button className="outline-button" onClick={() => void refill()}>Claim daily recovery allowance</button>{message && <p role="status">{message}</p>}</article>
      <div className="stat-grid"><article><span>ROUNDS</span><b>{stats.rounds_played}</b></article><article><span>HANDS WON</span><b>{stats.hands_won}</b></article><article><span>BLACKJACKS</span><b>{stats.blackjacks}</b></article><article><span>BIGGEST WIN</span><b>{money(stats.biggest_win)}</b></article><article><span>WIN RATE</span><b>{decisions ? Math.round(stats.hands_won / decisions * 100) : 0}%</b></article><article><span>PUSHES</span><b>{stats.hands_pushed}</b></article></div>
    </section>
  </PageFrame>;
}

export function HistoryPage() {
  const { data, error } = useAccount(); const [ledger, setLedger] = useState<Array<Record<string, string | number | null>>>([]);
  useEffect(() => { api<Array<Record<string, string | number | null>>>("me/ledger").then(setLedger).catch(() => undefined); }, []);
  if (!data) return <main className="loading-screen"><p>{error || "Loading history…"}</p></main>;
  return <PageFrame user={{ ...data.user, balance: data.wallet.balance }} kicker="SESSION HISTORY" title="Every chip accounted for.">
    <section className="ledger-card"><header><span>RECENT BALANCE EVENTS</span><b>{ledger.length} entries</b></header>{ledger.length ? ledger.map((item) => <div className="ledger-row" key={String(item.id)}><span className={`ledger-amount ${Number(item.amount) > 0 ? "positive" : Number(item.amount) < 0 ? "negative" : ""}`}>{Number(item.amount) > 0 ? "+" : ""}{money(Number(item.amount))}</span><div><b>{String(item.reason).replaceAll("_", " ")}</b><small>{new Date(String(item.created_at)).toLocaleString()}</small></div><span>{money(Number(item.balance_after))}</span></div>) : <div className="history-empty">No rounds yet. The ledger is enjoying the quiet.</div>}</section>
  </PageFrame>;
}

export function SettingsPage() {
  const { data, error } = useAccount(); const [prefs, setPrefs] = useState(defaultPreferences);
  useEffect(() => { try { const value = localStorage.getItem("ls_preferences"); if (value) setPrefs((current) => ({ ...current, ...JSON.parse(value) })); } catch { /* Invalid local preferences are ignored. */ } }, []);
  const update = (next: Preferences) => { setPrefs(next); localStorage.setItem("ls_preferences", JSON.stringify(next)); };
  const toggleSound = () => { const sound = !prefs.sound; update({ ...prefs, sound }); if (sound) void playSound("notice", true, prefs.notificationVolume); };
  if (!data) return <main className="loading-screen"><p>{error || "Loading settings…"}</p></main>;
  return <PageFrame user={{ ...data.user, balance: data.wallet.balance }} kicker="ACCESSIBILITY & SOUND" title="Make the table behave.">
    <section className="settings-card">
      <div className="setting-row"><div><b>Sound</b><p>Original local effects. Muted until you enable them.</p></div><button className={`switch ${prefs.sound ? "on" : ""}`} onClick={toggleSound} aria-label="Toggle sound" aria-pressed={prefs.sound}><i /></button></div>
      <div className="setting-row range-row"><div><b>Game effects volume</b><p>Cards, chips, results, and buttons.</p></div><input aria-label="Game effects volume" type="range" min="0" max="1" step=".05" value={prefs.effectsVolume} onChange={(event) => update({ ...prefs, effectsVolume: Number(event.target.value) })} /></div>
      <div className="setting-row range-row"><div><b>Notification volume</b><p>Turn changes and table notices.</p></div><input aria-label="Notification volume" type="range" min="0" max="1" step=".05" value={prefs.notificationVolume} onChange={(event) => update({ ...prefs, notificationVolume: Number(event.target.value) })} /></div>
      <div className="setting-row"><div><b>Impact shake</b><p>Affects only the table presentation and scales with a result.</p></div><button className={`switch ${prefs.shake ? "on" : ""}`} onClick={() => update({ ...prefs, shake: !prefs.shake })} aria-label="Toggle impact shake" aria-pressed={prefs.shake}><i /></button></div>
      <div className="setting-row"><div><b>Reduce motion</b><p>Disables dealing travel, celebrations, and table shake.</p></div><button className={`switch ${prefs.reducedMotion ? "on" : ""}`} onClick={() => update({ ...prefs, reducedMotion: !prefs.reducedMotion })} aria-label="Toggle reduced motion" aria-pressed={prefs.reducedMotion}><i /></button></div>
    </section>
  </PageFrame>;
}

export function AdminPage() {
  const { data, error } = useAccount(); const [users, setUsers] = useState<AdminUser[]>([]); const [audit, setAudit] = useState<Array<Record<string, string | null>>>([]); const [message, setMessage] = useState("");
  const refresh = useCallback(async () => { try { const [nextUsers, nextAudit] = await Promise.all([api<AdminUser[]>("admin/users"), api<Array<Record<string, string | null>>>("admin/audit")]); setUsers(nextUsers); setAudit(nextAudit); } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Admin access unavailable"); } }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  async function adjust(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try { await post(`admin/users/${form.get("userId")}/wallet`, { operation: form.get("operation"), amount: Number(form.get("amount")), reason: form.get("reason") }); setMessage("Adjustment committed and audited."); await refresh(); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "Adjustment failed"); }
  }
  async function setStatus(user: AdminUser) {
    const status = user.status === "active" ? "suspended" : "active";
    try { await post(`admin/users/${user.id}/status`, { status, reason: `Administrator changed account status to ${status}` }); setMessage(`Account is now ${status}.`); await refresh(); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "Status change failed"); }
  }
  if (!data) return <main className="loading-screen"><p>{error || "Loading administration…"}</p></main>;
  return <PageFrame user={{ ...data.user, balance: data.wallet.balance }} kicker="ROLE-PROTECTED" title="Casino administration">
    <section className="admin-layout">
      <form className="admin-form" onSubmit={adjust}><h2>Adjust play money</h2><label>Player<select name="userId">{users.map((user) => <option value={user.id} key={user.id}>{user.display_name} — {money(user.balance)}</option>)}</select></label><label>Operation<select name="operation"><option value="grant">Grant</option><option value="remove">Remove</option><option value="reset">Reset to starting balance</option></select></label><label>Amount<input name="amount" type="number" min="0" defaultValue="500" /></label><label>Audit reason<input name="reason" required minLength={3} maxLength={200} /></label><button className="cream-button">Commit adjustment</button>{message && <p role="status">{message}</p>}</form>
      <div className="admin-users"><header><span>ACCOUNT</span><span>BALANCE</span><span>STATUS</span><span>ACTION</span></header>{users.map((user) => <div key={user.id}><b>{user.display_name}</b><span>{money(user.balance)}</span><span>{user.status}</span><button className="quiet-button" onClick={() => void setStatus(user)}>{user.status === "active" ? "Suspend" : "Restore"}</button></div>)}</div>
    </section>
    <section className="ledger-card admin-audit"><header><span>RECENT ADMIN AUDIT</span><b>{audit.length} entries</b></header>{audit.slice(0, 20).map((entry) => <div className="ledger-row" key={String(entry.id)}><span>{String(entry.action)}</span><div><b>{String(entry.reason)}</b><small>{new Date(String(entry.created_at)).toLocaleString()}</small></div><span>{String(entry.target_user_id ?? "system")}</span></div>)}</section>
  </PageFrame>;
}
