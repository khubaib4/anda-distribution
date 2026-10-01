'use client'
import { useRef } from 'react'

// Reuse the same key for uncertain/network retries; a changed form gets a new
// key. The server compares the entire payload before returning a saved result.
export function useCustomerAccountRequest() {
  const current = useRef<{ signature: string; requestId: string } | null>(null)
  return {
    withRequestId(payload: Record<string, unknown>) {
      const signature = JSON.stringify(payload)
      if (current.current?.signature !== signature) {
        current.current = { signature, requestId: crypto.randomUUID() }
      }
      return { ...payload, request_id: current.current.requestId }
    },
    resetRequest() { current.current = null },
  }
}
