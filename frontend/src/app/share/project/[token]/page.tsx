'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Loader2, FolderOpen, Target, Clock } from 'lucide-react';

interface SharedLog {
  id: number;
  content: string;
  author: string | null;
  created_at: string | null;
}

interface SharedFeature {
  id: number;
  name: string;
  logs: SharedLog[];
}

interface SharedProject {
  project_name: string;
  features: SharedFeature[];
}

function formatDate(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function SharedProjectPage() {
  const params = useParams();
  const token = params?.token as string;
  const [data, setData] = useState<SharedProject | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await fetch(`/api/public/project-share/${token}`);
        if (!res.ok) {
          setError(res.status === 404 ? 'Link chia sẻ không hợp lệ hoặc đã hết hạn.' : 'Không tải được dữ liệu.');
          return;
        }
        setData(await res.json());
      } catch {
        setError('Không tải được dữ liệu.');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F4F6FB] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[#0058be]" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-[#F4F6FB] flex items-center justify-center px-4">
        <div className="bg-white border border-slate-200 rounded-xl p-6 text-center max-w-md shadow-sm">
          <p className="text-sm text-slate-600">{error || 'Không tải được dữ liệu.'}</p>
        </div>
      </div>
    );
  }

  const totalLogs = data.features.reduce((sum, f) => sum + f.logs.length, 0);

  return (
    <div className="min-h-screen bg-[#F4F6FB] px-4 py-10">
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-[#0058be]/10 flex items-center justify-center shrink-0">
            <FolderOpen className="w-5 h-5 text-[#0058be]" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Tính năng &amp; WIP Log — chia sẻ công khai</p>
            <h1 className="text-lg font-extrabold text-slate-900 truncate">{data.project_name}</h1>
            <p className="text-xs text-slate-500 mt-0.5">{data.features.length} tính năng · {totalLogs} log</p>
          </div>
        </div>

        {data.features.length === 0 && (
          <div className="bg-white border border-slate-200 rounded-xl p-6 text-center text-sm text-slate-400 shadow-sm">
            Dự án này chưa có tính năng/log nào được ghi lại.
          </div>
        )}

        {data.features.map((f) => (
          <div key={f.id} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2 bg-slate-50/50">
              <Target className="w-4 h-4 text-[#0058be] shrink-0" />
              <h2 className="text-sm font-bold text-slate-800 truncate">{f.name}</h2>
              <span className="ml-auto text-[11px] font-semibold text-slate-400">{f.logs.length} log</span>
            </div>
            <div className="divide-y divide-slate-100">
              {f.logs.map((log) => (
                <div key={log.id} className="px-4 py-3.5">
                  <div className="flex items-center gap-2 text-[11px] text-slate-400 mb-1.5">
                    <Clock className="w-3 h-3" />
                    <span>{formatDate(log.created_at)}</span>
                    {log.author && <span>· {log.author}</span>}
                  </div>
                  <p className="text-[13px] text-slate-700 leading-relaxed whitespace-pre-wrap break-words">{log.content}</p>
                </div>
              ))}
              {f.logs.length === 0 && (
                <div className="px-4 py-4 text-center text-xs text-slate-400">Chưa có log nào.</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
