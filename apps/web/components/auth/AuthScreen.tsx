"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../lib/client/api";
import type { SessionUser } from "../../packages/contracts/src";
import { Brand } from "../ui/Brand";
import { PlayingCard } from "../cards/PlayingCard";

export function AuthScreen() {
  const router = useRouter(); const [confirmed, setConfirmed] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const local = process.env.NODE_ENV !== "production";
  useEffect(()=>{ api<{user:SessionUser}|null>("auth/session").then((session)=>{if(session)router.replace("/lobby")}).catch(()=>undefined); },[router]);
  const devLogin = async (persona: "chris"|"maya"|"arthur") => { if(!confirmed){setError("Confirm the age and play-money notice first.");return} setBusy(true);setError("");try{await api("auth/dev",{method:"POST",body:JSON.stringify({persona}),idempotent:false});router.push("/lobby");router.refresh()}catch(reason){setError(reason instanceof Error?reason.message:"Sign-in failed")}finally{setBusy(false)} };
  return <main className="auth-screen">
    <div className="auth-glow"/><div className="auth-card-fan" aria-hidden="true"><PlayingCard rank="A" suit="spade"/><PlayingCard rank="K" suit="heart"/><PlayingCard rank="7" suit="club"/></div>
    <section className="auth-copy"><Brand/><span className="overline">PRIVATE BLACKJACK WITH FRIENDS</span><h1>Lose your chips.<br/><em>Keep your friends.</em></h1><p>A proper private table for your Discord call. Real blackjack rules, virtual currency, and a dealer with exactly enough patience.</p>
      <div className="auth-points"><span><i>01</i>Server-run games</span><span><i>02</i>Up to seven seats</span><span><i>03</i>No money involved</span></div>
    </section>
    <section className="signin-card" aria-labelledby="signin-title"><span className="overline">WELCOME TO THE TABLE</span><h2 id="signin-title">One sensible confirmation.</h2><p>Low Stakes is a social game. Its currency has no cash value and cannot be bought, sold, withdrawn, or won as a prize.</p>
      <label className="age-check"><input type="checkbox" checked={confirmed} onChange={(event)=>setConfirmed(event.target.checked)}/><span className="check-box"/><span>I confirm I meet the minimum permitted age for play-money casino games where I live, and I understand this is not real-money gambling.</span></label>
      <a className={`discord-button ${!confirmed?"disabled":""}`} aria-disabled={!confirmed} href={confirmed?"/api/v1/auth/discord?ageConfirmed=true":"#"} onClick={(event)=>{if(!confirmed){event.preventDefault();setError("Confirm the notice before continuing.")}}}><span className="discord-glyph"><i/><i/></span>Continue with Discord</a>
      {local&&<div className="dev-signin"><span>LOCAL DEVELOPMENT</span><div><button disabled={busy} onClick={()=>devLogin("chris")}>Enter as Chris</button><button disabled={busy} onClick={()=>devLogin("maya")}>Enter as Maya</button><button disabled={busy} onClick={()=>devLogin("arthur")}>Enter as Arthur</button></div></div>}
      {error&&<p className="form-error" role="alert">{error}</p>}<small>By continuing, you agree to the <a href="/legal#terms">terms</a> and acknowledge the <a href="/legal#privacy">privacy notice</a>.</small>
    </section>
  </main>;
}
