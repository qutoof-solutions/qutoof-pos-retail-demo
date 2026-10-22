"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

type Detection = { rawValue: string };
type Detector = { detect: (source: HTMLVideoElement) => Promise<Detection[]> };
type DetectorConstructor = { new (options: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> };

export function BarcodeCamera({ onDetected, onClose }: { onDetected: (value: string) => void; onClose: () => void }) {
  const t = useTranslations("remaining-platform-print");
  const videoRef = useRef<HTMLVideoElement>(null);
  const handlersRef = useRef({ onDetected, onClose });
  const [error, setError] = useState("");
  useEffect(() => { handlersRef.current = { onDetected, onClose }; }, [onDetected, onClose]);
  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    let stream: MediaStream | undefined;
    const stop = () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
    const start = async () => {
      try {
        const DetectorApi = (window as Window & { BarcodeDetector?: DetectorConstructor }).BarcodeDetector;
        if (!DetectorApi) throw new Error(t("barcodeCamera.unsupported"));
        const wanted = ["code_128", "ean_13", "ean_8", "upc_a", "upc_e", "qr_code", "code_39", "itf"];
        const supported = DetectorApi.getSupportedFormats ? await DetectorApi.getSupportedFormats() : wanted;
        const formats = wanted.filter((format) => supported.includes(format));
        if (!formats.length) throw new Error(t("barcodeCamera.noFormats"));
        const detector = new DetectorApi({ formats });
        const openedStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" } } });
        if (stopped) { openedStream.getTracks().forEach((track) => track.stop()); return; }
        stream = openedStream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        const scan = async () => {
          if (stopped || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes[0]?.rawValue) {
              const value = codes[0].rawValue;
              stop();
              handlersRef.current.onDetected(value);
              handlersRef.current.onClose();
              return;
            }
          } catch { /* Continue scanning; unsupported frames can be transient. */ }
          if (!stopped) timer = window.setTimeout(scan, 220);
        };
        void scan();
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : t("barcodeCamera.startError");
        setError(message);
      }
    };
    void start();
    return stop;
  }, [t]);
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/75 p-4" role="dialog" aria-modal="true" aria-label={t("barcodeCamera.dialogLabel")}><div className="w-full max-w-lg rounded-2xl bg-white p-4 shadow-xl"><div className="mb-3 flex items-center justify-between"><h2 className="font-bold text-navy">{t("barcodeCamera.title")}</h2><Button variant="outline" onClick={onClose}>{t("common.close")}</Button></div><video ref={videoRef} muted playsInline className="aspect-video w-full rounded-xl bg-slate-950 object-cover" />{error && <p role="alert" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}<p className="mt-3 text-xs text-slate-500">{t("barcodeCamera.privacyNote")}</p></div></div>;
}
