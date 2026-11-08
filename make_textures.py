#!/usr/bin/env python3
"""Builds assets/suit.webp and assets/jacket.webp from the two Grok front-view renders (Session 7, texture version).
Steps per image: crop the front figure, cut the figure out of the grey studio background (GrabCut), push the figure's own colours a few pixels outward over the
background, then fade to a smooth fabric average (so sampling outside the figure never shows grey or streaks), flatten the baked studio lighting a bit (the live camera supplies the light), upscale 2x.
Usage: python3 tools/make_textures.py suit.jpg jacket.jpg   (needs opencv-python, numpy, scipy, pillow). The crop rectangles must match TEX in config.js."""
import sys, numpy as np, cv2
from PIL import Image
from scipy import ndimage as ndi

JOBS = {  # name: (crop x, y, w, h in the source picture, flatten strength 0..1, grabcut rect inside the crop)
    'suit':   dict(crop=(170, 70, 270, 600),  flat=0.55, bgfit=26, thr=9),
    'jacket': dict(crop=(235, 90, 375, 860),  flat=0.45),
}
UP = 2

def build(src, name, job):
    x, y, w, h = job['crop']
    im = cv2.imread(src)[y:y + h, x:x + w].copy()
    # --- figure cut-out. Dark-on-dark suit: model the smooth grey studio backdrop (quadratic fit to the left/right margins) and keep what differs from it;
    # the bright jacket uses GrabCut instead.
    if job.get('bgfit'):
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32); m0 = np.zeros((h, w), bool); mw = job['bgfit']; m0[:, :mw] = True; m0[:, -mw:] = True
        A = np.stack([np.ones_like(xx), xx / w, yy / h, (xx / w) ** 2, (yy / h) ** 2, xx * yy / (w * h)], -1)
        bgm = np.zeros((h, w, 3), np.float32)
        for c in range(3): bgm[..., c] = A @ np.linalg.lstsq(A[m0], im[..., c][m0].astype(np.float32), rcond=None)[0]
        d = np.abs(im.astype(np.float32) - bgm).max(-1); d = cv2.GaussianBlur(d, (0, 0), 1.2)
        fg = (d > job['thr']).astype(np.uint8)
        fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
        n, lbl, st, _ = cv2.connectedComponentsWithStats(fg); keep = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA])); fg = (lbl == keep).astype(np.uint8)
        fg = ndi.binary_fill_holes(fg).astype(np.uint8); fg = cv2.erode(fg, np.ones((3, 3), np.uint8))
        cv2.imwrite(f'/tmp/{name}_d.png', np.clip(d * 6, 0, 255).astype(np.uint8))
    else:
        fg = None
    mask = np.full((h, w), cv2.GC_PR_BGD, np.uint8)
    mask[:6, :] = cv2.GC_BGD; mask[:, :4] = cv2.GC_BGD; mask[:, -4:] = cv2.GC_BGD
    inner = np.zeros((h, w), bool); inner[int(h * .05):, int(w * .22):int(w * .78)] = True   # the middle of the picture is certainly figure
    mask[inner] = cv2.GC_PR_FGD
    bgd = np.zeros((1, 65), np.float64); fgd = np.zeros((1, 65), np.float64)
    if fg is None:
        cv2.grabCut(im, mask, None, bgd, fgd, 6, cv2.GC_INIT_WITH_MASK)
        fg = np.isin(mask, (cv2.GC_FGD, cv2.GC_PR_FGD)).astype(np.uint8)
        fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)); fg = cv2.erode(fg, np.ones((3, 3), np.uint8))   # shave the halo
    lab = cv2.cvtColor(im, cv2.COLOR_BGR2LAB).astype(np.float32)
    # --- flatten baked light: divide by the (figure-only) blurred luminance, partially
    f = fg.astype(np.float32); L = lab[..., 0]
    num = cv2.GaussianBlur(L * f, (0, 0), 14); den = cv2.GaussianBlur(f, (0, 0), 14) + 1e-4
    blur = num / den; target = float(np.median(L[fg > 0]))
    gain = np.clip(target / np.maximum(blur, 8), 0.6, 1.8) ** job['flat']
    lab[..., 0] = np.clip(L * gain, 0, 255)
    out = cv2.cvtColor(lab.astype(np.uint8), cv2.COLOR_LAB2BGR)
    # --- extend the figure's colours over the background (nearest figure pixel)
    dist, idx = ndi.distance_transform_edt(fg == 0, return_distances=True, return_indices=True)
    ext = out[idx[0], idx[1]]
    # beyond a few pixels the nearest-pixel extension turns into streaks; fade to a smooth average of the nearby fabric instead
    fgf = fg.astype(np.float32)[..., None]; of = out.astype(np.float32)
    smooth = cv2.GaussianBlur(of * fgf, (0, 0), 30) / (cv2.GaussianBlur(fgf, (0, 0), 30)[..., None] + 1e-3)
    smooth = np.where(cv2.GaussianBlur(fgf, (0, 0), 30)[..., None] > 1e-3, smooth, of[fg > 0].mean(0))
    wgt = np.clip(1 - (dist - 5) / 12, 0, 1)[..., None].astype(np.float32)
    out = (ext.astype(np.float32) * wgt + smooth * (1 - wgt)).clip(0, 255).astype(np.uint8)
    out = cv2.resize(out, (w * UP, h * UP), interpolation=cv2.INTER_LANCZOS4)
    blur2 = cv2.GaussianBlur(out, (0, 0), 1.2); out = cv2.addWeighted(out, 1.5, blur2, -0.5, 0)       # light unsharp after the upscale
    Image.fromarray(cv2.cvtColor(out, cv2.COLOR_BGR2RGB)).save(f'assets/{name}.webp', quality=88, method=6)
    cv2.imwrite(f'/tmp/{name}_fg.png', fg * 255)
    print(name, out.shape[1], 'x', out.shape[0], 'fg share', round(float(fg.mean()), 2))

if __name__ == '__main__':
    build(sys.argv[1], 'suit', JOBS['suit']); build(sys.argv[2], 'jacket', JOBS['jacket'])
