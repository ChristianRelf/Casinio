"use client";

export type DealerPose = "idle" | "dealing" | "reveal" | "waiting" | "house-win" | "player-win";

export function DealerNpc({ pose = "idle" }: { pose?: DealerPose }) {
  return (
    <div className={`dealer-npc dealer-pose-${pose}`} aria-label={`The automated dealer is ${pose.replace("-", " ")}`}>
      <svg viewBox="0 0 260 236" role="img" aria-hidden="true">
        <defs>
          <linearGradient id="vest" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#282b27"/><stop offset="1" stopColor="#111411"/></linearGradient>
          <linearGradient id="shirt" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#f0e5cf"/><stop offset="1" stopColor="#b9aa91"/></linearGradient>
          <filter id="dealer-shadow"><feDropShadow dx="0" dy="7" stdDeviation="6" floodOpacity=".45"/></filter>
        </defs>
        <ellipse cx="130" cy="224" rx="86" ry="10" fill="#020403" opacity=".5"/>
        <g filter="url(#dealer-shadow)" className="npc-body">
          <path d="M76 213q4-63 30-80h48q27 17 31 80Z" fill="url(#vest)" stroke="#9c7c43" strokeWidth="1.4"/>
          <path d="m105 132 25 36 25-36-8-9h-34Z" fill="url(#shirt)"/>
          <path d="m120 137 10 12 10-12-3 35-7 13-7-13Z" fill="#241b19"/>
          <path d="M82 208q6-57 29-73l19 50 20-50q24 16 29 73" fill="none" stroke="#b18c4a" strokeWidth="2"/>
          <path d="M96 150q-11 26-9 59M164 150q11 26 9 59" fill="none" stroke="#4c4f47" strokeWidth="1"/>
          <path d="M108 132 95 146l18 8 17 31-17-52ZM152 132l13 14-18 8-17 31 17-52Z" fill="#171a17" stroke="#8c713f" strokeWidth="1"/>
          <path d="M109 158q21 10 42 0M104 174q26 12 52 0" fill="none" stroke="#6b5735" strokeWidth=".8" opacity=".55"/>
          <circle cx="151" cy="181" r="2.4" fill="#b69451"/><circle cx="154" cy="193" r="2.4" fill="#b69451"/>
        </g>
        <g className="npc-neck"><path d="M113 128v15q17 13 34 0v-17" fill="#c79674" stroke="#6d4633" strokeWidth="1"/></g>
        <g className="npc-head" filter="url(#dealer-shadow)">
          <path d="M91 66q2-49 41-50 41 2 39 52l-8 43q-13 24-34 24-22-1-33-25Z" fill="#d4a17c" stroke="#6d4633" strokeWidth="1.2"/>
          <path d="M94 77q-13-24 1-45 12-20 38-21 27 0 40 24 7 14-3 42l-8-27-8 11-5-25q-25 22-53 23Z" fill="#241c19"/>
          <path d="M94 51q6-32 33-37-5 8-4 14 12-17 29-7-7 5-9 11 15-10 27 5-9 1-13 8 13-3 17 9-9 0-15 7" fill="none" stroke="#765331" strokeWidth="3" strokeLinecap="round"/>
          <path d="M104 79q9-7 18 0M139 79q9-7 18 0" fill="none" stroke="#523329" strokeWidth="2.2" strokeLinecap="round"/>
          <g className="npc-eyes" fill="#211b17"><ellipse cx="114" cy="84" rx="2.6" ry="2"/><ellipse cx="148" cy="84" rx="2.6" ry="2"/></g>
          <path d="m131 84-3 17 7 2" fill="none" stroke="#986b51" strokeWidth="1.4" strokeLinecap="round"/>
          <path className="npc-mouth" d="M117 111q13 7 26-1" fill="none" stroke="#704438" strokeWidth="1.8" strokeLinecap="round"/>
          <path d="M99 73q10-8 24-2M138 70q14-6 23 3" fill="none" stroke="#39251f" strokeWidth="3" strokeLinecap="round"/>
          <path d="M104 99q3 21 25 24 22-2 28-24-2 29-28 32-24-3-25-32Z" fill="#9c6a50" opacity=".18"/>
        </g>
        <g className="npc-arm npc-arm-left">
          <path d="M103 146q-22 2-31 24l-24 37 21 7 30-28Z" fill="url(#shirt)" stroke="#7d6c57" strokeWidth="1.2"/>
          <path d="m49 205-18 9q-7 5 1 10h29q8-2 8-10Z" fill="#cf9b75" stroke="#6d4633" strokeWidth="1"/>
          <path d="M82 164 62 199" stroke="#8e7a62" strokeWidth="1"/>
        </g>
        <g className="npc-arm npc-arm-right">
          <path d="M157 146q22 2 31 24l24 37-21 7-30-28Z" fill="url(#shirt)" stroke="#7d6c57" strokeWidth="1.2"/>
          <path d="m211 205 18 9q7 5-1 10h-29q-8-2-8-10Z" fill="#cf9b75" stroke="#6d4633" strokeWidth="1"/>
          <path d="m178 164 20 35" stroke="#8e7a62" strokeWidth="1"/>
          <g className="npc-deal-card"><rect x="215" y="198" width="24" height="34" rx="2" fill="#f0e6d2" stroke="#8a744e"/><path d="m221 207 4-5 4 5-4 5Z" fill="#a83a35"/></g>
        </g>
      </svg>
    </div>
  );
}
