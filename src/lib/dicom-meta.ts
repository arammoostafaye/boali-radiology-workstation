/* ------------------------------------------------------------------ */
/*  Minimal server-side DICOM header reader.                           */
/*                                                                    */
/*  Reads just enough of Part-10 to answer ONE question reliably:     */
/*  "what modality / patient / study is this file?" — used to route   */
/*  a downloaded PACS package into its DEDICATED module room          */
/*  (MG → Mammography AI, CT → 3D CT Studio, DX/CR → Fracture room)   */
/*  based on the ACTUAL DICOM metadata, not on guesses.               */
/*                                                                    */
/*  Supported transfer syntaxes (covers every hospital package we     */
/*  have seen):                                                       */
/*    1.2.840.10008.1.2      Implicit VR Little Endian (default)      */
/*    1.2.840.10008.1.2.1    Explicit VR Little Endian                */
/*    1.2.840.10008.1.2.2    Explicit VR Big Endian                   */
/*  Encapsulated/compressed pixel data is fine — the tags we need     */
/*  sit in the header, before the bulk pixel data.                    */
/* ------------------------------------------------------------------ */

export interface DicomMeta {
  modality: string | null;
  patientName: string | null;
  patientId: string | null;
  studyDescription: string | null;
  seriesDescription: string | null;
  rows: number | null;
  columns: number | null;
  transferSyntax: string | null;
}

interface VrInfo {
  vr: string;
  length: number;
  headerLen: number;
}

const LONG_VRS = new Set(["OB", "OD", "OF", "OL", "OV", "OW", "SQ", "UC", "UR", "UT", "UN"]);

function readVr(buf: Buffer, off: number, explicit: boolean, implicitVr: string): VrInfo | null {
  if (off + 4 > buf.length) return null;
  if (!explicit) {
    /* implicit: 4-byte tag + 4-byte length, VR looked up (we only need
       a few well-known long-form VRs; everything else is treated short) */
    const length = buf.readUInt32LE(off + 4);
    const vr = implicitVr;
    const long = LONG_VRS.has(vr) && length === 0xffffffff ? false : false;
    return { vr, length: long ? 0 : length, headerLen: 4 };
  }
  const vr = buf.toString("ascii", off + 4, off + 6);
  if (LONG_VRS.has(vr)) {
    if (off + 12 > buf.length) return null;
    const length = buf.readUInt32LE(off + 8);
    return { vr, length, headerLen: 8 };
  }
  if (off + 8 > buf.length) return null;
  const length = buf.readUInt16LE(off + 6);
  return { vr, length, headerLen: 4 };
}

function tagAt(buf: Buffer, off: number, bigEndian: boolean): string {
  const g = bigEndian ? buf.readUInt16BE(off) : buf.readUInt16LE(off);
  const e = bigEndian ? buf.readUInt16BE(off + 2) : buf.readUInt16LE(off + 2);
  return (
    g.toString(16).padStart(4, "0") + "," + e.toString(16).padStart(4, "0")
  ).toUpperCase();
}

function readString(buf: Buffer, start: number, len: number): string {
  if (len <= 0 || start + len > buf.length) return "";
  return buf
    .toString("utf8", start, start + len)
    .replace(/\u0000+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function readU16(buf: Buffer, off: number, bigEndian: boolean): number | null {
  if (off + 2 > buf.length) return null;
  return bigEndian ? buf.readUInt16BE(off) : buf.readUInt16LE(off);
}

/** well-known implicit-VR types for the tags we care about */
const IMPLICIT_VR: Record<string, string> = {
  "0008,0060": "CS",
  "0008,1030": "LO",
  "0008,103E": "LO",
  "0010,0010": "PN",
  "0010,0020": "LO",
  "0028,0010": "US",
  "0028,0011": "US",
  "0002,0010": "UI",
};

/** Parse the header of one DICOM file (path or buffer). */
export function readDicomMeta(input: Buffer): DicomMeta | null {
  const buf = input;
  if (buf.length < 256) return null;

  let pos = 0;
  let explicit = true;
  let bigEndian = false;

  /* Part-10 file with preamble? (128 zero bytes + "DICM") */
  if (buf.length > 132 && buf.toString("ascii", 128, 132) === "DICM") {
    pos = 132;
  } else {
    /* raw dataset — sniff: plausible explicit group 0008/0010/0002 tag? */
    const first = tagAt(buf, 0, false);
    explicit = false; /* assume implicit for raw streams */
    if (!/^(0002|0008|0010|0018)/.test(first)) {
      /* maybe explicit little-endian without preamble */
      const vr = buf.toString("ascii", 4, 6);
      if (/^[A-Z]{2}$/.test(vr)) {
        explicit = true;
      } else {
        return null; /* not a DICOM dataset we can read */
      }
    }
    /* dataset with no file-meta: default transfer = implicit LE */
  }

  const meta: DicomMeta = {
    modality: null,
    patientName: null,
    patientId: null,
    studyDescription: null,
    seriesDescription: null,
    rows: null,
    columns: null,
    transferSyntax: null,
  };

  let guard = 0;
  let inMetaGroup = true;

  while (pos + 8 <= buf.length && guard++ < 4096) {
    const tag = tagAt(buf, pos, bigEndian);

    /* file-meta group is ALWAYS explicit little-endian */
    const useExplicit = tag.startsWith("0002,") ? true : explicit;

    const info = readVr(buf, pos, useExplicit, IMPLICIT_VR[tag] ?? "OB");
    if (!info) break;

    const dataStart = pos + 4 + info.headerLen;

    if (tag === "0002,0010") {
      meta.transferSyntax = readString(buf, dataStart, info.length);
      if (meta.transferSyntax === "1.2.840.10008.1.2") {
        explicit = false;
        bigEndian = false;
      } else if (meta.transferSyntax === "1.2.840.10008.1.2.2") {
        explicit = true;
        bigEndian = true;
      } else if (meta.transferSyntax.startsWith("1.2.840.10008.1.2.4")) {
        /* JPEG (encapsulated) — header is still explicit LE */
        explicit = true;
        bigEndian = false;
      } else if (meta.transferSyntax.startsWith("1.2.840.10008.1.2.5")) {
        explicit = false;
        bigEndian = false;
      } else {
        explicit = true;
        bigEndian = false;
      }
    } else if (tag === "0008,0060") {
      meta.modality = readString(buf, dataStart, Math.min(info.length, 16)) || meta.modality;
    } else if (tag === "0010,0010") {
      meta.patientName =
        readString(buf, dataStart, Math.min(info.length, 192)).replace(/\^/g, " ").trim() ||
        meta.patientName;
    } else if (tag === "0010,0020") {
      meta.patientId = readString(buf, dataStart, Math.min(info.length, 64)) || meta.patientId;
    } else if (tag === "0008,1030") {
      meta.studyDescription =
        readString(buf, dataStart, Math.min(info.length, 128)) || meta.studyDescription;
    } else if (tag === "0008,103E") {
      meta.seriesDescription =
        readString(buf, dataStart, Math.min(info.length, 128)) || meta.seriesDescription;
    } else if (tag === "0028,0010") {
      const v = readU16(buf, dataStart, bigEndian);
      if (v) meta.rows = v;
    } else if (tag === "0028,0011") {
      const v = readU16(buf, dataStart, bigEndian);
      if (v) meta.columns = v;
    }

    /* stop once past the header area into bulk pixel data */
    const group = parseInt(tag.slice(0, 4), 16);
    if (group > 0x0028 && !inMetaGroup) break;
    if (group > 0x0002) inMetaGroup = false;
    if (group >= 0x7fe0) break; /* pixel data */

    /* skip undefined-length sequences conservatively */
    if (info.length === 0xffffffff) {
      /* sequence with undefined length — scan for item delimiters is
         overkill for our tags; bail out of the sequence by scanning
         for the next plausible tag boundary is unreliable → stop. */
      break;
    }

    pos = dataStart + info.length;
    if (pos <= dataStart) break;
  }

  const hasSomething =
    meta.modality ?? meta.patientName ?? meta.patientId ?? meta.rows;
  return hasSomething !== null ? meta : null;
}

/** Majority-vote modality across several files of one study. */
export function detectStudy(
  files: { name: string; size: number }[],
  readFn: (name: string) => Promise<Buffer | null>
): Promise<{
  modality: string | null;
  patientName: string | null;
  patientId: string | null;
  studyDescription: string | null;
  sampled: number;
}> {
  const votes = new Map<string, number>();
  let patientName: string | null = null;
  let patientId: string | null = null;
  let studyDescription: string | null = null;
  let sampled = 0;

  const sample = files
    .filter((f) => f.size >= 512 && /\.(dcm|dicom|\.raw)?$|^[^.]*$/i.test(f.name))
    .sort((a, b) => b.size - a.size)
    .slice(0, 8);

  return (async () => {
    for (const f of sample) {
      if (sampled >= 5) break;
      try {
        const buf = await readFn(f.name);
        if (!buf) continue;
        const m = readDicomMeta(buf);
        if (!m) continue;
        sampled++;
        if (m.modality) {
          const k = m.modality.toUpperCase().slice(0, 3);
          votes.set(k, (votes.get(k) ?? 0) + 1);
        }
        patientName = patientName ?? m.patientName;
        patientId = patientId ?? m.patientId;
        studyDescription = studyDescription ?? m.studyDescription;
      } catch {
        /* unreadable file — next */
      }
    }
    let modality: string | null = null;
    let best = 0;
    for (const [k, v] of votes) {
      if (v > best) {
        best = v;
        modality = k;
      }
    }
    return { modality, patientName, patientId, studyDescription, sampled };
  })();
}
