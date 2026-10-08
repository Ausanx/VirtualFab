"""300 K bulk-Si Poisson/Boltzmann model using DEVSIM's potential-only equations."""
import json
import math
import sys
import os
import ctypes
from pathlib import Path
from importlib.metadata import version

# Preload by Unicode path; DEVSIM can then resolve the ASCII DLL name on Windows.
math_directory = Path(sys._MEIPASS) if getattr(sys, "frozen", False) else Path(__file__).resolve().parents[1] / "artifacts/openblas-0.3.31/win64/bin"
math_dll = math_directory / "libopenblas.dll"
if math_dll.is_file():
    os.environ["OPENBLAS_NUM_THREADS"] = "1"
    math_library = ctypes.CDLL(str(math_dll))
    os.environ["DEVSIM_MATH_LIBS"] = "libopenblas.dll"

import devsim as ds
from devsim.python_packages.model_create import CreateSolution
from devsim.python_packages.simple_physics import (
    CreateSiliconPotentialOnly,
    CreateSiliconPotentialOnlyContact,
    GetContactBiasName,
)

Q = 1.602176634e-19
VT = 8.617333262145e-5 * 300
EPS = 11.7 * 8.8541878128e-14  # F/cm
EG = 1.12
NC, NV = 2.8e19, 1.04e19
NI = math.sqrt(NC * NV) * math.exp(-EG / (2 * VT))
EC0 = VT * math.log(NC / NI)


def validate(c):
    if c.get("material") != "Si" or c.get("temperatureK") != 300:
        raise ValueError("Only 300 K bulk Si is supported.")
    ranges = {"acceptorCm3": (1e14, 1e18), "donorCm3": (1e14, 1e18),
              "pLengthUm": (.1, 20), "nLengthUm": (.1, 20),
              "intrinsicLengthUm": (0, 20), "meshNm": (2, 100)}
    for key, (low, high) in ranges.items():
        v = c.get(key)
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not low <= v <= high:
            raise ValueError("Invalid " + key)
    if 0 < c["intrinsicLengthUm"] * 1000 < 4 * c["meshNm"]:
        raise ValueError("Intrinsic region is underresolved.")
    if sum(c[k] for k in ("pLengthUm", "intrinsicLengthUm", "nLengthUm")) * 1000 / c["meshNm"] > 6000:
        raise ValueError("Mesh is too large.")


def solve(c, spacing_nm, suffix):
    mesh, device, region = "mesh" + suffix, "device" + suffix, "silicon"
    lp, li, ln = [c[k] * 1e-4 for k in ("pLengthUm", "intrinsicLengthUm", "nLengthUm")]
    end = lp + li + ln
    spacing = spacing_nm * 1e-7
    ds.create_1d_mesh(mesh=mesh)
    points = [(0, "left"), (lp, "junction")]
    if li > 0:
        points.append((lp + li, "junction2"))
    points.append((end, "right"))
    for pos, tag in points:
        ds.add_1d_mesh_line(mesh=mesh, pos=pos, ps=spacing, tag=tag)
    ds.add_1d_region(mesh=mesh, region=region, material="Si", tag1="left", tag2="right")
    for contact in ("left", "right"):
        ds.add_1d_contact(mesh=mesh, name=contact, tag=contact, material="metal")
    ds.finalize_mesh(mesh=mesh)
    ds.create_device(mesh=mesh, device=device)
    args = {"device": device, "region": region}
    for name, value in {"Permittivity": EPS, "ElectronCharge": Q, "n_i": NI, "V_t": VT}.items():
        ds.set_parameter(**args, name=name, value=value)
    ds.node_solution(**args, name="NetDoping")
    positions = ds.get_node_model_values(**args, name="x")
    ordered = sorted(enumerate(positions), key=lambda item: item[1])
    doping = [0.0] * len(positions)
    # Integrate the step profile over each actual finite-volume cell, including unequal junction spacings.
    for j, (node, x) in enumerate(ordered):
        left = (ordered[j - 1][1] + x) / 2 if j else 0
        right = (x + ordered[j + 1][1]) / 2 if j < len(ordered) - 1 else end
        p_width = max(0, min(right, lp) - left)
        n_width = max(0, right - max(left, lp + li))
        doping[node] = (-c["acceptorCm3"] * p_width + c["donorCm3"] * n_width) / (right - left)
    ds.set_node_values(**args, name="NetDoping", values=doping)
    CreateSolution(device, region, "Potential")
    left = -VT * math.asinh(c["acceptorCm3"] / (2 * NI))
    right = VT * math.asinh(c["donorCm3"] / (2 * NI))
    ds.set_node_values(**args, name="Potential", values=[left + (right - left) * x / end for x in positions])
    CreateSiliconPotentialOnly(device, region)
    for contact in ("left", "right"):
        ds.set_parameter(device=device, name=GetContactBiasName(contact), value=0)
        CreateSiliconPotentialOnlyContact(device, region, contact)
    info = ds.solve(type="dc", absolute_error=1e-10, relative_error=1e-6, maximum_iterations=100, info=True)
    potential = ds.get_node_model_values(**args, name="Potential")
    electrons = ds.get_node_model_values(**args, name="IntrinsicElectrons")
    holes = ds.get_node_model_values(**args, name="IntrinsicHoles")
    rows = sorted([{"xUm": x * 1e4, "potentialV": p, "ecEv": EC0 - p,
                    "evEv": EC0 - p - EG, "efEv": 0, "electronCm3": n,
                    "holeCm3": h, "netDopingCm3": d}
                   for x, p, n, h, d in zip(positions, potential, electrons, holes, doping)], key=lambda r: r["xUm"])
    fields = [{"xUm": .5 * (a["xUm"] + b["xUm"]),
               "fieldVcm": -(b["potentialV"] - a["potentialV"]) / ((b["xUm"] - a["xUm"]) * 1e-4)}
              for a, b in zip(rows, rows[1:])]
    ds.delete_device(device=device)
    ds.delete_mesh(mesh=mesh)
    return {"rows": rows, "fields": fields, "peakFieldVcm": max(abs(f["fieldVcm"]) for f in fields),
            "builtInV": rows[-1]["potentialV"] - rows[0]["potentialV"], "converged": bool(info["converged"])}


def interpolate(rows, x):
    for a, b in zip(rows, rows[1:]):
        if a["xUm"] <= x <= b["xUm"]:
            t = (x - a["xUm"]) / (b["xUm"] - a["xUm"])
            return a["potentialV"] * (1 - t) + b["potentialV"] * t
    return rows[-1]["potentialV"]


def run(c):
    validate(c)
    coarse = solve(c, c["meshNm"], "coarse")
    fine = solve(c, c["meshNm"] / 2, "fine")
    delta = max(abs(r["potentialV"] - interpolate(fine["rows"], r["xUm"])) for r in coarse["rows"])
    field_delta = abs(coarse["peakFieldVcm"] - fine["peakFieldVcm"]) / fine["peakFieldVcm"]
    na, nd = c["acceptorCm3"], c["donorCm3"]
    vbi = VT * math.log(na * nd / NI ** 2)
    # The PIN depletion oracle assumes an undoped, depleted i region and neutral remote contacts.
    li = c["intrinsicLengthUm"] * 1e-4
    inv = 1 / na + 1 / nd
    sheet = 2 * EPS * vbi / Q / (li + math.sqrt(li ** 2 + 2 * inv * EPS * vbi / Q))
    xp, xn = sheet / na, sheet / nd
    oracle = {"builtInV": vbi, "pDepletionUm": xp * 1e4, "nDepletionUm": xn * 1e4,
              "totalDepletionUm": (xp + li + xn) * 1e4, "peakFieldVcm": Q * sheet / EPS,
              "remoteContactsValid": xp * 1e4 < .8 * c["pLengthUm"] and xn * 1e4 < .8 * c["nLengthUm"]}
    warnings = []
    if not oracle["remoteContactsValid"]:
        warnings.append("耗尽近似触及端部；加长 p/n 区后再与无限体解析值比较。")
    if delta > .002 or field_delta > .02:
        warnings.append("网格减半仍改变电势超过 2 mV 或峰值电场超过 2%，请减小网格间距。")
    if oracle["remoteContactsValid"] and abs(fine["peakFieldVcm"] / oracle["peakFieldVcm"] - 1) > .15:
        warnings.append("耗尽近似峰值场与数值解相差超过 15%；该近似忽略接面附近的移动电荷，不能作为此算例的精确标定值。")
    return {"schemaVersion": 1, "model": "devsim-si-equilibrium", "solverVersion": version("devsim"),
            "mathLibraries": ds.get_parameter(name="info")["math_libraries"],
            "config": c, "parameters": {"temperatureK": 300, "gapEv": EG, "ncCm3": NC, "nvCm3": NV,
                                       "niCm3": NI, "relativePermittivity": 11.7},
            **fine, "oracle": oracle, "meshCheck": {"requestedNm": c["meshNm"], "returnedNm": c["meshNm"] / 2,
                "potentialDifferenceV": delta, "peakFieldRelativeDifference": field_delta,
                "withinTolerance": delta <= .002 and field_delta <= .02}, "warnings": warnings}


if __name__ == "__main__":
    try:
        content = sys.stdin.read(16001)
        if len(content) > 16000:
            raise ValueError("Request is too large.")
        result = run(json.loads(content))
        print("VIRTUALFAB_RESULT:" + json.dumps(result, allow_nan=False))
    except Exception as error:
        print("VIRTUALFAB_RESULT:" + json.dumps({"error": str(error)}))
        sys.exit(1)
