import { notFound, redirect } from "next/navigation";
import { getCarousel } from "../../../../src/db.js";
import { currentUser } from "../../lib/supabaseServer";
import { isValidUuid } from "../../lib/isValidUuid";
import { Studio } from "./Studio";

export const dynamic = "force-dynamic";

export default async function CarouselStudioPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  if (!isValidUuid(id)) notFound();
  const carousel = await getCarousel(id);
  // Never fall back to a local deck: a missing carousel must not render
  // something that could be exported by mistake.
  if (!carousel) notFound();

  return (
    <Studio
      carouselId={carousel.id}
      draftId={carousel.source_draft_id}
      slides={carousel.slides}
      watermark={carousel.watermark}
      alreadySent={carousel.status === "sent"}
      declinedReason={carousel.status === "declined" ? (carousel.decline_reason ?? "no reason recorded") : null}
    />
  );
}
