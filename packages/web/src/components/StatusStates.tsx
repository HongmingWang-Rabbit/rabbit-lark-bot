'use client';

import { mutate } from 'swr';

export function LoadingState() {
  return (
    <div className="text-center py-12" role="status">
      <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" aria-hidden="true" />
      <p className="mt-2 text-gray-500">加载中...</p>
    </div>
  );
}

export function ErrorState({ message, retryKey, onRetry }: { message: string; retryKey?: string; onRetry?: () => void }) {
  const handleRetry = onRetry ?? (retryKey ? () => mutate(retryKey) : undefined);
  return (
    <div className="text-center py-12" role="alert">
      <p className="text-red-500">加载失败</p>
      <p className="text-sm text-gray-500 mt-2">{message}</p>
      {handleRetry && (
        <button onClick={handleRetry} className="mt-4 text-blue-500 hover:underline">
          重试
        </button>
      )}
    </div>
  );
}
