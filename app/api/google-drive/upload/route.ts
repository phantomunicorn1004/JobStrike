import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

/**
 * Upload file to Google Drive
 * Uploads to /Job-Mart-Sheet/Resumes/{jobId}/
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { fileData, fileName, mimeType, jobId } = body;

    if (!fileData || !fileName || !mimeType || !jobId) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: fileData, fileName, mimeType, jobId",
        },
        { status: 400 }
      );
    }

    // Get access token from cookies
    const cookieStore = await cookies();
    let accessToken = cookieStore.get("google_drive_access_token")?.value;
    const refreshToken = cookieStore.get("google_drive_refresh_token")?.value;

    if (!accessToken) {
      return NextResponse.json(
        { error: "Not authenticated with Google Drive. Please authorize first." },
        { status: 401 }
      );
    }

    // Refresh token if needed (simplified - in production, check expiry)
    // For now, try to use refresh token if access token fails

    // Convert base64 to buffer
    const fileBuffer = Buffer.from(fileData, "base64");

    // Step 1: Find or create the folder structure
    // /Job-Mart-Sheet/Resumes/{jobId}/
    const folderPath = ["Job-Mart-Sheet", "Resumes", String(jobId)];
    let parentFolderId = "root";

    // Find or create each folder in the path
    for (const folderName of folderPath) {
      parentFolderId = await findOrCreateFolder(
        accessToken,
        folderName,
        parentFolderId
      );
    }

    // Step 2: Upload file to the target folder
    const uploadResult = await uploadFile(
      accessToken,
      fileBuffer,
      fileName,
      mimeType,
      parentFolderId
    );

    if (!uploadResult.success) {
      // Try refreshing token and retry once
      if (refreshToken && uploadResult.error?.includes("401")) {
        const newAccessToken = await refreshAccessToken(refreshToken);
        if (newAccessToken) {
          // Update cookie
          cookieStore.set("google_drive_access_token", newAccessToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            maxAge: 60 * 60,
          });

          // Retry upload
          const retryResult = await uploadFile(
            newAccessToken,
            fileBuffer,
            fileName,
            mimeType,
            parentFolderId
          );

          if (retryResult.success) {
            return NextResponse.json({
              fileId: retryResult.fileId,
              fileUrl: retryResult.fileUrl,
              uploadedAt: new Date().toISOString(),
            });
          }
        }
      }

      return NextResponse.json(
        { error: uploadResult.error || "Failed to upload file" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      fileId: uploadResult.fileId,
      fileUrl: uploadResult.fileUrl,
      uploadedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Google Drive upload error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred during upload",
      },
      { status: 500 }
    );
  }
}

/**
 * Find or create a folder in Google Drive
 */
async function findOrCreateFolder(
  accessToken: string,
  folderName: string,
  parentId: string
): Promise<string> {
  // First, try to find the folder
  const searchResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name='${encodeURIComponent(
      folderName
    )}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (searchResponse.ok) {
    const data = await searchResponse.json();
    if (data.files && data.files.length > 0) {
      return data.files[0].id;
    }
  }

  // Folder doesn't exist, create it
  const createResponse = await fetch(
    "https://www.googleapis.com/drive/v3/files",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: folderName,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId],
      }),
    }
  );

  if (!createResponse.ok) {
    const error = await createResponse.json();
    throw new Error(
      `Failed to create folder: ${error.error?.message || "Unknown error"}`
    );
  }

  const folderData = await createResponse.json();
  return folderData.id;
}

/**
 * Upload a file to Google Drive
 */
async function uploadFile(
  accessToken: string,
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  parentFolderId: string
): Promise<{ success: boolean; fileId?: string; fileUrl?: string; error?: string }> {
  try {
    // Create metadata
    const metadata = {
      name: fileName,
      parents: [parentFolderId],
    };

    // Create multipart body manually for Node.js
    const boundary = `----WebKitFormBoundary${Math.random().toString(36).substring(2)}`;
    const metadataPart = `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(metadata)}\r\n`;
    const filePart = `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
    const endBoundary = `\r\n--${boundary}--\r\n`;

    // Combine all parts
    const bodyBuffer = Buffer.concat([
      Buffer.from(metadataPart, "utf-8"),
      Buffer.from(filePart, "utf-8"),
      fileBuffer,
      Buffer.from(endBoundary, "utf-8"),
    ]);

    const uploadResponse = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
          "Content-Length": bodyBuffer.length.toString(),
        },
        body: bodyBuffer,
      }
    );

    if (!uploadResponse.ok) {
      const error = await uploadResponse.json();
      return {
        success: false,
        error: error.error?.message || "Failed to upload file",
      };
    }

    const fileData = await uploadResponse.json();
    const fileUrl = `https://drive.google.com/file/d/${fileData.id}/view`;

    return {
      success: true,
      fileId: fileData.id,
      fileUrl,
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to upload file",
    };
  }
}

/**
 * Refresh Google Drive access token
 */
async function refreshAccessToken(
  refreshToken: string
): Promise<string | null> {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return null;
    }

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!response.ok) {
      return null;
    }

    const tokens = await response.json();
    return tokens.access_token;
  } catch (error) {
    console.error("Token refresh error:", error);
    return null;
  }
}
