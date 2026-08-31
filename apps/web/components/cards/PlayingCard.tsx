import type { CSSProperties } from "react";
import { RANKS, SUITS, type Rank, type Suit } from "../../packages/game-core/src";
import "./cards.css";

export { RANKS, SUITS };
export type { Rank, Suit };

const suitPath: Record<Suit, string> = {
  heart: "M12 21C10 18.6 3 13.7 3 8.7A4.7 4.7 0 0 1 11.3 5.7L12 6.5l.7-.8A4.7 4.7 0 0 1 21 8.7c0 5-7 9.9-9 12.3Z",
  diamond: "M12 2 20 12 12 22 4 12 12 2Z",
  club: "M12 3a4.2 4.2 0 0 1 3.3 6.8 4.2 4.2 0 1 1 1.3 7.9H14c.2 1.5.7 2.5 2 3.3H8c1.3-.8 1.8-1.8 2-3.3H7.4a4.2 4.2 0 1 1 1.3-7.9A4.2 4.2 0 0 1 12 3Z",
  spade: "M12 2c2 3.1 8.4 7.2 8.4 12a4.6 4.6 0 0 1-8 3.1c.2 1.9.8 3.1 2.3 4H9.3c1.5-.9 2.1-2.1 2.3-4a4.6 4.6 0 0 1-8-3.1C3.6 9.2 10 5.1 12 2Z",
};

export function SuitGlyph({ suit, className = "" }: { suit: Suit; className?: string }) {
  return <svg className={`deck-suit deck-suit-${suit} ${className}`} viewBox="0 0 24 24" aria-hidden="true"><path d={suitPath[suit]} /></svg>;
}

const pipPositions: Record<Exclude<Rank, "A" | "J" | "Q" | "K">, Array<[number, number, boolean?]>> = {
  "2": [[50, 23], [50, 77, true]],
  "3": [[50, 20], [50, 50], [50, 80, true]],
  "4": [[31, 23], [69, 23], [31, 77, true], [69, 77, true]],
  "5": [[31, 22], [69, 22], [50, 50], [31, 78, true], [69, 78, true]],
  "6": [[31, 20], [69, 20], [31, 50], [69, 50], [31, 80, true], [69, 80, true]],
  "7": [[31, 18], [69, 18], [50, 35], [31, 50], [69, 50], [31, 82, true], [69, 82, true]],
  "8": [[31, 17], [69, 17], [50, 33], [31, 50], [69, 50], [50, 67, true], [31, 83, true], [69, 83, true]],
  "9": [[31, 17], [69, 17], [31, 39], [69, 39], [50, 50], [31, 61, true], [69, 61, true], [31, 83, true], [69, 83, true]],
  "10": [[31, 15], [69, 15], [50, 29], [31, 38], [69, 38], [31, 62, true], [69, 62, true], [50, 71, true], [31, 85, true], [69, 85, true]],
};

function CourtHalf({ rank, suit, inverted = false }: { rank: "J" | "Q" | "K"; suit: Suit; inverted?: boolean }) {
  const isRed = suit === "heart" || suit === "diamond";
  const accent = isRed ? "#a83a35" : "#172725";
  const second = rank === "Q" ? "#55766b" : rank === "K" ? "#b49450" : "#6d4c69";
  return (
    <g transform={inverted ? "rotate(180 50 70)" : undefined}>
      <path d="M21 7h58v57H21z" fill="#eadfc9" stroke="#b89f6c" strokeWidth="1.2" />
      <path d="M24 10h52v49H24z" fill="none" stroke={accent} strokeWidth="1" />
      {rank === "K" && <path d="M39 20 44 10l6 8 6-8 5 10-4 6H43Z" fill="#b49450" stroke="#6f5522" strokeWidth="1" />}
      {rank === "Q" && <path d="M38 17q12-11 24 0l-4 7H42Z" fill={second} stroke="#263d37" strokeWidth="1" />}
      {rank === "J" && <path d="m38 18 12-9 12 9-7 6H43Z" fill={second} stroke="#432c42" strokeWidth="1" />}
      <circle cx="50" cy="29" r="9" fill="#d7b493" stroke="#563d2e" strokeWidth="1" />
      <path d="M43 29q7 4 14 0M46 26h1M53 26h1" fill="none" stroke="#563d2e" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M31 61q2-24 19-24t19 24Z" fill={accent} />
      <path d="M43 39 50 49l7-10 6 22H37Z" fill={second} opacity=".95" />
      <path d="M50 46v15M37 50l26 8M63 50 37 58" stroke="#eadfc9" strokeWidth="2" opacity=".72" />
      {rank === "K" && <path d="M67 21v40M63 24h8M64 56h6" stroke="#876b32" strokeWidth="2.8" />}
      {rank === "Q" && <path d="M68 22q-7 12 0 23t-1 16" fill="none" stroke="#a83a35" strokeWidth="2.5" />}
      {rank === "J" && <path d="m68 21-6 34 4 6 4-6Z" fill="#c0a25f" stroke="#5c4923" strokeWidth="1" />}
      <SuitGlyph suit={suit} className="court-suit" />
    </g>
  );
}

function CourtFigure({ rank, suit }: { rank: "J" | "Q" | "K"; suit: Suit }) {
  return <svg className="court-figure" viewBox="0 0 100 140" aria-hidden="true"><CourtHalf rank={rank} suit={suit} /><CourtHalf rank={rank} suit={suit} inverted /><path d="M19 69h62M23 73h54" stroke="#b89f6c" strokeWidth="1" /></svg>;
}

export function PlayingCard({ rank, suit, hidden = false, compact = false, className = "", style }: { rank: Rank; suit: Suit; hidden?: boolean; compact?: boolean; className?: string; style?: CSSProperties }) {
  const red = suit === "heart" || suit === "diamond";
  return (
    <div className={`deck-card ${red ? "deck-red" : "deck-black"} ${hidden ? "deck-hidden" : ""} ${compact ? "deck-compact" : ""} ${className}`} style={style} role="img" aria-label={hidden ? "Face-down card" : `${rank === "A" ? "Ace" : rank === "J" ? "Jack" : rank === "Q" ? "Queen" : rank === "K" ? "King" : rank} of ${suit}s`}>
      <div className="deck-card-inner">
        <div className="deck-card-front">
          <div className="corner corner-top"><b>{rank}</b><SuitGlyph suit={suit} /></div>
          {rank === "A" ? <div className="ace-emblem"><span><SuitGlyph suit={suit} /></span><i /></div> : ["J", "Q", "K"].includes(rank) ? <CourtFigure rank={rank as "J" | "Q" | "K"} suit={suit} /> : <div className="pip-field">{pipPositions[rank as keyof typeof pipPositions].map(([x, y, flip], index) => <span key={index} style={{ left: `${x}%`, top: `${y}%` }}><SuitGlyph suit={suit} className={flip ? "pip-flip" : ""} /></span>)}</div>}
          <div className="corner corner-bottom"><b>{rank}</b><SuitGlyph suit={suit} /></div>
        </div>
        <div className="deck-card-back"><div className="back-frame"><div className="back-lattice"><span>LS</span></div></div></div>
      </div>
    </div>
  );
}

export function CardBack(props: { compact?: boolean; className?: string; style?: CSSProperties }) { return <PlayingCard rank="A" suit="spade" hidden {...props} />; }
