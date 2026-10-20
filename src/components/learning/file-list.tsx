import { FileText, Image as ImageIcon } from "lucide-react";

export type FileRow = { id: string; fileName: string; mimeType: string; sizeBytes: number };

const size = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Attachment links. Every link goes through the access-checked download route; nothing is public. */
export function FileList({ files, remove }: { files: FileRow[]; remove?: (f: FileRow) => React.ReactNode }) {
  if (!files.length) return null;
  return (
    <ul className="space-y-2">
      {files.map((f) => (
        <li key={f.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2">
          {f.mimeType.startsWith("image/") ? <ImageIcon className="size-5 shrink-0 text-brand-600" aria-hidden /> : <FileText className="size-5 shrink-0 text-brand-600" aria-hidden />}
          <a href={`/api/learning/files/${f.id}`} target="_blank" rel="noopener" className="min-w-0 flex-1 truncate text-sm font-medium text-link hover:underline">{f.fileName}</a>
          <span className="text-xs text-muted">{size(f.sizeBytes)}</span>
          {remove?.(f)}
        </li>
      ))}
    </ul>
  );
}
