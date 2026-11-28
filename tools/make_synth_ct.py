#!/usr/bin/env python3
"""Generate a contiguous SYNTHETIC chest CT series for the 3D studio demo.

The previously bundled sample ("patient11/SPC") is a sparse scout with
acquisition gaps up to 132 mm — honest to render, but fragmented-looking.
This script builds a clearly-labeled synthetic phantom with an intact
rib cage, spine, sternum, lungs, heart and soft-tissue wall on a
uniform 1.5 mm grid, so the MPR + volume-rendering pipeline can be
demonstrated end-to-end. No patient data. No fabrication at runtime —
the voxels are what they are: an openly synthetic phantom.
"""

import os

import numpy as np
import pydicom
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.uid import CTImageStorage, ExplicitVRLittleEndian, generate_uid

OUT = os.path.join(os.path.dirname(__file__), "..", "mini-services",
                   "boali-engine", "samples", "CT-chest-synth")
NX = NY = 384
NZ = 160
SP = 0.9          # in-plane spacing mm
DZ = 1.5          # slice spacing mm
X0 = Y0 = NX // 2

AIR, LUNG, FAT, SOFT, MUSCLE, BLOOD, MARROW, BONE = (
    -1000, -780, -90, 40, 55, 60, 240, 1150)


def phantom_slice(iz: int) -> np.ndarray:
    z = (iz - NZ / 2) * DZ          # mm, 0 at mid-chest
    t = z / (NZ / 2 * DZ)           # -1..1 taper
    vol = np.full((NY, NX), AIR, dtype=np.int16)

    # --- thorax wall (tapered ellipse) ---
    yy, xx = np.mgrid[0:NY, 0:NX]
    a = 150 * (1 - 0.12 * t * t)    # x semi-axis
    b = 100 * (1 - 0.10 * t * t)    # y semi-axis
    cy = Y0 + 8 * t
    r = ((xx - X0) / a) ** 2 + ((yy - cy) / b) ** 2
    wall = r <= 1.0
    vol[wall] = MUSCLE
    vol[wall & (r > 0.82)] = FAT    # subcutaneous fat ring

    # --- lungs (two ellipsoids, z-tapered) ---
    for cx, side in ((X0 - 62, "L"), (X0 + 62, "R")):
        ax, ay = 52 * (1 - 0.25 * t * t), 66 * (1 - 0.22 * t * t)
        rl = ((xx - cx) / ax) ** 2 + ((yy - cy + 4) / ay) ** 2
        m = (rl <= 1.0) & (r < 0.78)
        vol[m] = LUNG
        # vessels: bright streaks near the medial lung
        medial = (rl <= 1.0) & (r < 0.78) & (np.abs(xx - cx) < ax * 0.45)
        vol[medial & (rl > 0.55)] = BLOOD

    # --- heart (slightly left-anterior, lower half) ---
    if z < 30:
        hw = 1.0 - max(0.0, (z - 30)) / 90
        rh = ((xx - X0 + 18) / (46 * hw)) ** 2 + ((yy - cy + 14) / (56 * hw)) ** 2
        vol[(rh <= 1.0) & (r < 0.8)] = BLOOD

    # --- spine: vertebral body + processes ---
    vol[(np.abs(xx - X0) < 24) & (np.abs(yy - (cy + 62)) < 20)] = BONE
    vol[(np.abs(xx - X0) < 14) & (np.abs(yy - (cy + 62)) < 11)] = MARROW
    vol[(np.abs(xx - X0) < 5) & (yy > cy + 55) & (yy < cy + 88)] = BONE  # spinous

    # --- sternum (anterior bar, upper 2/3) ---
    if z > -70:
        vol[(np.abs(xx - X0) < 17) & (np.abs(yy - (cy - 78)) < 7)] = BONE

    # --- rib cage: 11 arcs sloping anteriorly, open at the spine ---
    anteriority = np.clip((cy - yy) / b, -1.0, 1.0)   # +1 front, -1 back
    posterior_gap = ((yy - cy) > 0.45 * b) & (np.abs(xx - X0) < 0.55 * a)
    for k in range(11):
        zk = -95 + k * 18
        z_rib = zk + 6.0 * np.clip(anteriority, 0, 1)  # ribs dip forward
        shell = (r > 0.60) & (r < 0.78) & ~posterior_gap
        on = np.abs(z - z_rib) < 4.2
        m = shell & wall & on
        vol[m] = np.maximum(vol[m], BONE)

    # --- trachea (upper half) ---
    if z > 20:
        tr = ((xx - X0) / 11) ** 2 + ((yy - (cy + 6)) / 11) ** 2
        vol[tr <= 1.0] = AIR

    # --- table under the patient (thin, like a real acquisition) ---
    vol[(yy > NY - 26) & (np.abs(xx - X0) < 190)] = BONE // 2

    return vol


def write_series():
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        if f.endswith(".dcm"):
            os.remove(os.path.join(OUT, f))
    for iz in range(NZ):
        ds = Dataset()
        ds.file_meta = FileMetaDataset()
        ds.file_meta.MediaStorageSOPClassUID = CTImageStorage
        ds.file_meta.MediaStorageSOPInstanceUID = generate_uid()
        ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
        ds.SOPClassUID = CTImageStorage
        ds.SOPInstanceUID = ds.file_meta.MediaStorageSOPInstanceUID
        ds.StudyInstanceUID = generate_uid()
        ds.SeriesInstanceUID = generate_uid()
        ds.Modality = "CT"
        ds.PatientName = "SYNTHETIC^PHANTOM"
        ds.PatientID = "SYNTH-0001"
        ds.PatientBirthDate = ""
        ds.PatientSex = "O"
        ds.StudyDate = "20260101"
        ds.SeriesDescription = "Synthetic chest phantom (contiguous, demo)"
        ds.Manufacturer = "Boali Demo Generator"
        ds.Rows = NY
        ds.Columns = NX
        ds.PixelSpacing = [SP, SP]
        ds.SliceThickness = DZ
        ds.ImagePositionPatient = [-(NX / 2) * SP, -(NY / 2) * SP, iz * DZ]
        ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
        ds.RescaleIntercept = 0
        ds.RescaleSlope = 1
        ds.InstanceNumber = iz + 1
        ds.SamplesPerPixel = 1
        ds.PhotometricInterpretation = "MONOCHROME2"
        ds.BitsAllocated = 16
        ds.BitsStored = 16
        ds.HighBit = 15
        ds.PixelRepresentation = 1
        ds.PixelData = phantom_slice(iz).tobytes()
        ds.save_as(os.path.join(OUT, f"{iz:04d}.dcm"), enforce_file_format=True)
    print(f"wrote {NZ} slices to {os.path.abspath(OUT)}")


if __name__ == "__main__":
    write_series()
