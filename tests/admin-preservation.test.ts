import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

test("Admin simplification leaves wallpaper management and its original image uploader byte-identical", () => {
  for (const [file, expected] of [
    ["src/components/admin/AppearanceSettings.tsx", "f8417c0b49703fdea97162f0c3d2f415e6483d6c5e83bcb9b050dc8f5fa26aff"],
    ["src/components/admin/ImageUploader.tsx", "ca2ea1764773426f97e4338b03ffb17fd5dab40d43dad6a1db1d50f16a1c0fc9"],
  ]) assert.equal(createHash("sha256").update(readFileSync(file)).digest("hex"), expected, file);
});
