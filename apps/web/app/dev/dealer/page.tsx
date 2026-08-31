import { notFound } from "next/navigation";
import { DealerNpc, type DealerPose } from "../../../components/game/DealerNpc";
import "../../../components/game/dealer.css";

const POSES: DealerPose[] = [
  "idle",
  "welcome",
  "deal",
  "waiting",
  "reveal",
  "dealer-win",
  "player-win",
  "blackjack",
  "bust",
  "table-event",
];

export default function DealerGallery() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main className="dealer-gallery">
      <header>
        <span className="overline">INTERNAL ASSET QA</span>
        <h1>Dealer pose registration</h1>
        <p>All ten transparent PNGs render on the same 1600 by 1600 canvas using the shared stage anchor X 2205, Y 304.</p>
      </header>
      <section>
        {POSES.map(pose => (
          <article key={pose}>
            <DealerNpc pose={pose} />
            <b>{pose.replaceAll("-", " ")}</b>
          </article>
        ))}
      </section>
    </main>
  );
}
