'use client';

import { useState, useCallback } from 'react';
import Image, { type ImageLoaderProps } from 'next/image';
import { useDropzone } from 'react-dropzone';
import { Upload, X, Loader2, Check } from 'lucide-react';

interface ReceiptUploadProps {
    organizationId: string;
    onUploadComplete: (fileUrl: string) => void;
}

function passthroughImageLoader({ src }: ImageLoaderProps): string {
    return src;
}

export function ReceiptUpload({ organizationId, onUploadComplete }: ReceiptUploadProps) {
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [preview, setPreview] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const onDrop = useCallback(
        async (acceptedFiles: File[]) => {
            if (acceptedFiles.length === 0) return;

            const file = acceptedFiles[0];
            setError(null);
            setUploading(true);
            setUploadProgress(0);

            // Create preview
            const reader = new FileReader();
            reader.onload = (e) => setPreview(e.target?.result as string);
            reader.readAsDataURL(file);

            try {
                // Step 1: Get presigned URL from backend
                const urlResponse = await fetch('/api/storage/upload-url', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-organization-id': organizationId,
                    },
                    body: JSON.stringify({
                        filename: file.name,
                        contentType: file.type,
                    }),
                });

                if (!urlResponse.ok) {
                    throw new Error('Failed to get upload URL');
                }

                const { uploadUrl, fileUrl } = await urlResponse.json();
                setUploadProgress(25);

                // Step 2: Upload directly to S3
                const uploadResponse = await fetch(uploadUrl, {
                    method: 'PUT',
                    body: file,
                    headers: {
                        'Content-Type': file.type,
                    },
                });

                if (!uploadResponse.ok) {
                    throw new Error('Failed to upload file');
                }

                setUploadProgress(100);

                // Call parent callback with the file URL
                setTimeout(() => {
                    onUploadComplete(fileUrl);
                    setUploading(false);
                }, 500);
            } catch (err) {
                console.error('Upload error:', err);
                setError(err instanceof Error ? err.message : 'Upload failed');
                setUploading(false);
                setPreview(null);
            }
        },
        [organizationId, onUploadComplete]
    );

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: {
            'image/*': ['.png', '.jpg', '.jpeg', '.heic'],
        },
        maxFiles: 1,
        disabled: uploading,
    });

    return (
        <div className="w-full">
            {!preview ? (
                <div
                    {...getRootProps()}
                    className={`
            border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
            transition-colors duration-200
            ${isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}
            ${uploading ? 'opacity-50 cursor-not-allowed' : ''}
          `}
                >
                    <input {...getInputProps()} />
                    <Upload className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                    <p className="text-lg font-medium text-gray-700 mb-2">
                        {isDragActive ? 'Drop receipt here' : 'Upload Receipt'}
                    </p>
                    <p className="text-sm text-gray-500">
                        Drag & drop a receipt image, or click to browse
                    </p>
                    <p className="text-xs text-gray-400 mt-2">
                        Supports: PNG, JPG, JPEG, HEIC
                    </p>
                </div>
            ) : (
                <div className="relative">
                    <Image
                        src={preview}
                        alt="Receipt preview"
                        width={1200}
                        height={800}
                        unoptimized
                        loader={passthroughImageLoader}
                        className="h-64 w-full rounded-lg bg-gray-100 object-contain"
                    />
                    {uploading && (
                        <div className="absolute inset-0 bg-black bg-opacity-50 rounded-lg flex flex-col items-center justify-center">
                            <Loader2 className="w-8 h-8 text-white animate-spin mb-2" />
                            <p className="text-white text-sm">Uploading... {uploadProgress}%</p>
                            <div className="w-48 h-2 bg-gray-300 rounded-full mt-2 overflow-hidden">
                                <div
                                    className="h-full bg-blue-500 transition-all duration-300"
                                    style={{ width: `${uploadProgress}%` }}
                                />
                            </div>
                        </div>
                    )}
                    {uploadProgress === 100 && !uploading && (
                        <div className="absolute top-2 right-2 bg-green-500 rounded-full p-2">
                            <Check className="w-5 h-5 text-white" />
                        </div>
                    )}
                    {!uploading && (
                        <button
                            onClick={() => setPreview(null)}
                            className="absolute top-2 left-2 bg-white rounded-full p-2 shadow-lg hover:bg-gray-100"
                        >
                            <X className="w-5 h-5 text-gray-600" />
                        </button>
                    )}
                </div>
            )}

            {error && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-sm text-red-700">{error}</p>
                </div>
            )}
        </div>
    );
}
