import Link from "next/link";

export function Brand({ compact = false }: { compact?: boolean }) {
  return <Link href="/lobby" className={`ls-brand ${compact ? "is-compact" : ""}`}><span className="ls-brand-mark"><i/><i/></span><span><b>LOW STAKES</b>{!compact && <small>PRIVATE TABLES</small>}</span></Link>;
}

export function Initials({ name }: { name: string }) {
  const value = name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(); return <span>{value || "LS"}</span>;
}
