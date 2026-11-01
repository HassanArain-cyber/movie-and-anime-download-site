import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { existsSync } from "fs";
import crypto from "crypto";

const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
];
const ALLOWED_VIDEO_TYPES = [
  "video/mp4",
  "video/webm",
  "video/x-matroska",
  "video/quicktime",
  "video/x-msvideo",
];

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_VIDEO_SIZE = 2 * 1024 * 1024 * 1024; // 2GB

// Route segment config (App Router)
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const authCheck = await requireAdmin();
  if (authCheck !== true) return authCheck;

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const type = (formData.get("type") as string) || "image"; // "image" or "video"

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const isImage = ALLOWED_IMAGE_TYPES.includes(file.type);
    const isVideo = ALLOWED_VIDEO_TYPES.includes(file.type);
    const requestedImage = type === "image";

    if (requestedImage && !isImage) {
      return NextResponse.json(
        { error: "Invalid image type. Allowed: JPG, PNG, WebP, GIF" },
        { status: 400 }
      );
    }
    if (!requestedImage && !isVideo) {
      return NextResponse.json(
        { error: "Invalid video type. Allowed: MP4, WebM, MKV, MOV, AVI" },
        { status: 400 }
      );
    }

    const maxSize = requestedImage ? MAX_IMAGE_SIZE : MAX_VIDEO_SIZE;
    if (file.size > maxSize) {
      return NextResponse.json(
        {
          error: `File too large. Max ${Math.round(
            maxSize / (1024 * 1024)
          )} MB`,
        },
        { status: 400 }
      );
    }

    const extMatch = file.name.match(/\.([a-z0-9]+)$/i);
    const ext = extMatch ? extMatch[1].toLowerCase() : "bin";
    const subdir = requestedImage ? "images" : "videos";
    const rand = crypto.randomBytes(8).toString("hex");
    const filename = `${Date.now()}-${rand}.${ext}`;
    const uploadDir = path.join(process.cwd(), "public", "uploads", subdir);

    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    const filePath = path.join(uploadDir, filename);
    const arrayBuffer = await file.arrayBuffer();
    await writeFile(filePath, Buffer.from(arrayBuffer));

    const publicUrl = `/uploads/${subdir}/${filename}`;
    return NextResponse.json({
      url: publicUrl,
      size: file.size,
      filename,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
