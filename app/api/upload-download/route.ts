import { NextRequest, NextResponse } from "next/server";

/**
 * Main API route for Step 7: Upload & Download
 * Handles resume download and optional Google Drive upload
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      downloadUrl,
      fileName,
      fileType,
      jobId,
      uploadToDrive,
    } = body;

    if (!downloadUrl || !fileName || !fileType) {
      return NextResponse.json(
        {
          error: "Missing required fields: downloadUrl, fileName, fileType",
        },
        { status: 400 }
      );
    }

    const result: {
      downloadUrl: string;
      googleDrive: {
        uploaded: boolean;
        fileId?: string;
        fileUrl?: string;
      };
    } = {
      downloadUrl,
      googleDrive: {
        uploaded: false,
      },
    };

    // Handle Google Drive upload if requested
    if (uploadToDrive && jobId) {
      try {
        // Fetch the file from the download URL
        // If it's a data URL, extract the base64 data
        let fileBuffer: Buffer;
        let mimeType: string;

        if (downloadUrl.startsWith("data:")) {
          // Data URL format: data:mimeType;base64,data
          const matches = downloadUrl.match(/^data:([^;]+);base64,(.+)$/);
          if (!matches) {
            throw new Error("Invalid data URL format");
          }
          mimeType = matches[1];
          const base64Data = matches[2];
          fileBuffer = Buffer.from(base64Data, "base64");
        } else {
          // Regular URL - fetch the file
          const fileResponse = await fetch(downloadUrl);
          if (!fileResponse.ok) {
            throw new Error("Failed to fetch file for upload");
          }
          const arrayBuffer = await fileResponse.arrayBuffer();
          fileBuffer = Buffer.from(arrayBuffer);
          mimeType =
            fileResponse.headers.get("content-type") ||
            (fileType === "pdf"
              ? "application/pdf"
              : "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        }

        // Upload to Google Drive
        const uploadResponse = await fetch(
          new URL("/api/google-drive/upload", request.url),
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              fileData: fileBuffer.toString("base64"),
              fileName,
              mimeType,
              jobId: String(jobId),
            }),
          }
        );

        if (uploadResponse.ok) {
          const uploadData = await uploadResponse.json();
          result.googleDrive = {
            uploaded: true,
            fileId: uploadData.fileId,
            fileUrl: uploadData.fileUrl,
          };
        } else {
          const errorData = await uploadResponse.json();
          console.error("Google Drive upload error:", errorData);
          // Don't fail the entire request if upload fails
          result.googleDrive.uploaded = false;
        }
      } catch (error) {
        console.error("Error uploading to Google Drive:", error);
        // Don't fail the entire request if upload fails
        result.googleDrive.uploaded = false;
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Upload download API error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred",
      },
      { status: 500 }
    );
  }
}
