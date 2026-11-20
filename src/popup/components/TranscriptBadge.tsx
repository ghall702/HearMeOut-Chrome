import { Ear, EarOff, FileText, Loader2 } from "lucide-react";

export function TranscriptBadge({ status }: { status?: string | undefined }) {
  if (status === "queued" || status === "processing")
    return (
      <span className="chip">
        <Loader2 className="spin" /> Transcribing
      </span>
    );
  if (status === "failed") return <span className="chip danger">Transcript failed</span>;
  if (status === "done")
    return (
      <span className="chip neutral">
        <FileText /> Transcript ready
      </span>
    );
  return null;
}

export function ListenedBadge({ firstPlayedAt, count }: { firstPlayedAt: string | null; count: number }) {
  return firstPlayedAt ? (
    <span className="chip success">
      <Ear /> Listened{count > 1 ? ` · ${count} plays` : ""}
    </span>
  ) : (
    <span className="chip neutral">
      <EarOff /> Not listened to yet
    </span>
  );
}
