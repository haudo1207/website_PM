'use client';
import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { getSheets, addSheet, checkSheet, deleteSheet, getSheetLogs } from '@/lib/api';
import { isAdmin } from '@/lib/auth';

interface Log {
  time: string;
  msg: string;
  level: string;
}

interface CS {
  id: number;
  status: string;
  logs: Log[];
}

export default function SheetsPage() {
  const router = useRouter();
  const [sheets, setSheets] = useState<any[]>([]);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [leaderEmail, setLeaderEmail] = useState('');
  const [pmEmail, setPmEmail] = useState('');
  const [memberEmails, setMemberEmails] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [sheetToDelete, setSheetToDelete] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ t: string; e: boolean } | null>(null);
  const [cs, setCs] = useState<CS | null>(null);
  const [showLog, setShowLog] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<any>(null);

  const reload = () => getSheets().then(setSheets).catch(() => {});

  useEffect(() => {
    reload();
    if (typeof window !== 'undefined' && window.location.search.includes('add=true')) {
      router.push('/projects/new');
    }
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [cs?.logs]);

  const flash = (t: string, e = false) => {
    setMsg({ t, e });
    setTimeout(() => setMsg(null), 4000);
  };

  const poll = (id: number) => {
    if (pollRef.current) clearInterval(pollRef.current);
    setCs({ id, status: 'running', logs: [] });
    setShowLog(true);
    pollRef.current = setInterval(async () => {
      try {
        const r = await getSheetLogs(id);
        setCs({ id, status: r.status, logs: r.logs || [] });
        if (r.status === 'success' || r.status === 'failed' || r.status === 'error') {
          clearInterval(pollRef.current);
          reload();
        }
      } catch {
        // Suppress errors during polling
      }
    }, 2000);
  };

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const d = await addSheet({
        url,
        name: name || 'Sheet',
        leader_email: leaderEmail || undefined,
        pm_email: pmEmail || undefined,
        member_emails: memberEmails || undefined,
        auto_create: false
      });
      setUrl('');
      setName('');
      setLeaderEmail('');
      setPmEmail('');
      setMemberEmails('');
      setShowAddModal(false);
      flash('Added & check started!');
      reload();
      poll(d.id);
    } catch {
      flash('Invalid URL or not shared with service account', true);
    }
  };

  const lc: Record<string, string> = {
    info: 'text-gray-300',
    warn: 'text-amber-400',
    error: 'text-red-400',
    success: 'text-emerald-400'
  };

  return (
    <div className="min-h-screen bg-[#0f1117] text-[#e2e8f0] flex">
      {/* Sidebar Navigation */}
      <Navbar />

      {/* Main Content Area */}
      <div className="flex-1 pl-[230px] flex flex-col min-h-screen">
        {/* Topbar */}
        <div className="h-[52px] bg-[#1a1d27] border-b border-[#2e3250] flex items-center justify-between px-6 sticky top-0 z-40">
          <h2 className="text-sm font-bold tracking-wider text-slate-200 uppercase">My Sheets</h2>
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/projects/new')}
              className="bg-[#6366f1] hover:bg-[#818cf8] text-white px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
              Tạo dự án mới
            </button>
          </div>
        </div>

        {/* Sheets Content */}
        <div className="p-6 space-y-6">
          {/* Header */}
          <div>
            <h1 className="text-xl font-bold text-slate-200">Google Sheets Listing</h1>
            <p className="text-xs text-[#64748b] mt-0.5">Quản lý và thực hiện quét các dự án Google Sheets của bạn</p>
          </div>

          {/* Global Toast Alert */}
          {msg && (
            <div
              className={`rounded-lg px-4 py-3 text-xs border shadow-sm ${
                msg.e
                  ? 'bg-red-950/40 text-[#f87171] border-red-800/40'
                  : 'bg-emerald-950/40 text-[#34d399] border-emerald-800/40'
              }`}
            >
              {msg.t}
            </div>
          )}

          {/* Log Worker Terminal */}
          {isAdmin() && showLog && cs != null && (
            <div className="bg-[#151821] rounded-xl border border-[#2e3250] overflow-hidden shadow-2xl">
              <div className="flex items-center justify-between px-4.5 py-2.5 border-b border-[#2e3250] bg-[#1a1d27] px-4 py-2">
                <div className="flex items-center gap-3">
                  {cs.status === 'running' ? (
                    <>
                      <div className="w-2 h-2 bg-[#34d399] rounded-full animate-pulse" />
                      <span className="text-[#34d399] text-[10px] font-bold uppercase tracking-wider">RUNNING WORKER</span>
                    </>
                  ) : cs.status === 'success' ? (
                    <>
                      <div className="w-2 h-2 bg-[#10b981] rounded-full" />
                      <span className="text-[#10b981] text-[10px] font-bold uppercase tracking-wider">COMPLETED SUCCESSFULLY</span>
                    </>
                  ) : (
                    <>
                      <div className="w-2 h-2 bg-[#ef4444] rounded-full" />
                      <span className="text-[#ef4444] text-[10px] font-bold uppercase tracking-wider">WORKER FAILED</span>
                    </>
                  )}
                  <span className="text-[#64748b] text-[10px] font-semibold">Sheet #{cs.id} · {cs.logs.length} entries</span>
                </div>
                <button
                  onClick={() => setShowLog(false)}
                  className="text-[#64748b] hover:text-[#e2e8f0] text-[10px] font-bold px-2.5 py-1 rounded bg-[#22263a] hover:bg-[#2a2f47] transition-all"
                >
                  Hide Console
                </button>
              </div>
              <div ref={logRef} className="h-56 overflow-y-auto p-4.5 p-4 space-y-1 font-mono text-[11px] leading-relaxed">
                {cs.logs.length === 0 && <p className="text-[#64748b] animate-pulse">Initializing worker channel, waiting for events...</p>}
                {cs.logs.map((l, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-[#64748b] w-24 flex-shrink-0">{l.time.split(' ')[1] || l.time}</span>
                    <span className={lc[l.level] || 'text-[#cbd5e1]'}>{l.msg}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sheets List Container */}
          <div className="bg-[#1a1d27] border border-[#2e3250] rounded-xl overflow-hidden shadow-xl">
            <div className="px-5 py-3 border-b border-[#2e3250] bg-[#1d202d] flex justify-between items-center">
              <span className="text-xs font-bold text-[#e2e8f0] uppercase tracking-wider">
                Active Project Sheets ({sheets.length})
              </span>
            </div>
            <table className="w-full text-xs text-[#cbd5e1]">
              <thead>
                <tr className="bg-[#22263a] border-b border-[#2e3250]">
                  <th className="text-left px-5 py-3 text-[10px] font-bold text-[#64748b] uppercase tracking-wider">Sheet</th>
                  <th className="text-left px-5 py-3 text-[10px] font-bold text-[#64748b] uppercase tracking-wider">Access / Roles</th>
                  <th className="text-left px-5 py-3 text-[10px] font-bold text-[#64748b] uppercase tracking-wider">Violations</th>
                  <th className="text-left px-5 py-3 text-[10px] font-bold text-[#64748b] uppercase tracking-wider">Last Check</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2e3250]">
                {sheets.map(s => {
                  const running = cs != null && cs.id === s.id && cs.status === 'running';
                  return (
                    <tr key={s.id} className={`hover:bg-[#1e2235] transition-colors ${running ? 'bg-[#6366f1]/5' : ''}`}>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-bold text-[#e2e8f0] text-xs">{s.name || 'Unnamed Project'}</p>
                          {s.project_code && (
                            <span className="bg-[#2e3250] text-[#cbd5e1] border border-[#3f446e] px-1.5 py-0.5 rounded text-[8px] font-semibold uppercase tracking-wider">
                              {s.project_code}
                            </span>
                          )}
                          {s.current_phase && (
                            <span className="bg-[#3b82f6]/10 text-[#60a5fa] border border-[#3b82f6]/20 px-1.5 py-0.5 rounded text-[8px] font-semibold">
                              {s.current_phase}
                            </span>
                          )}
                        </div>
                        {s.customer_name && (
                          <p className="text-[10px] text-[#94a3b8] mt-0.5">Khách hàng: {s.customer_name}</p>
                        )}
                        <a
                          href={s.spreadsheet_url || `https://docs.google.com/spreadsheets/d/${s.spreadsheet_id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] text-[#818cf8] hover:text-[#a5b4fc] hover:underline font-medium flex items-center gap-1 mt-1"
                        >
                          <span>🔗</span> Mở Google Sheet
                        </a>
                      </td>
                      <td className="px-5 py-3 text-[10px] space-y-1">
                        {s.leader_email && (
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-[#818cf8] bg-[#6366f1]/15 border border-[#6366f1]/20 px-1.5 py-0.2 rounded text-[8px] tracking-wide">LEADER</span>
                            <span className="text-[#94a3b8]">{s.leader_email}</span>
                          </div>
                        )}
                        {s.pm_email && (
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-[#38bdf8] bg-[#3b82f6]/15 border border-[#3b82f6]/20 px-1.5 py-0.2 rounded text-[8px] tracking-wide">PM</span>
                            <span className="text-[#94a3b8]">{s.pm_email}</span>
                          </div>
                        )}
                        {s.member_emails && (
                          <div className="flex items-center gap-1.5 truncate max-w-[200px]" title={s.member_emails}>
                            <span className="font-bold text-[#34d399] bg-[#10b981]/15 border border-[#10b981]/20 px-1.5 py-0.2 rounded text-[8px] tracking-wide">MEMBERS</span>
                            <span className="text-[#94a3b8] truncate">{s.member_emails}</span>
                          </div>
                        )}
                        {!s.leader_email && !s.pm_email && !s.member_emails && (
                          <span className="text-[#64748b] italic text-[10px]">No custom permissions</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {running ? (
                          <div className="flex items-center gap-2">
                            <div className="w-3.5 h-3.5 border-2 border-[#6366f1] border-t-transparent rounded-full animate-spin" />
                            <span className="text-[#818cf8] text-[10px] truncate max-w-xs font-semibold">
                              {cs.logs.length > 0 ? cs.logs[cs.logs.length - 1].msg.slice(0, 45) : 'Checking...'}
                            </span>
                          </div>
                        ) : s.violation_count > 0 ? (
                          <div className="flex gap-2 items-center">
                            <span className="bg-[#ef4444]/15 text-[#f87171] border border-[#ef4444]/25 px-2.5 py-0.5 rounded text-[10px] font-bold">
                              {s.fail_count} FAIL
                            </span>
                            <span className="text-[#64748b] text-[10px] font-semibold">{s.violation_count} total</span>
                          </div>
                        ) : (
                          <span className="text-[#34d399] text-[10px] font-bold">No violations</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-[10px] text-[#64748b] font-medium">
                        {s.last_checked
                          ? new Date(s.last_checked).toLocaleString('en-GB', {
                              day: '2-digit',
                              month: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit'
                            })
                          : 'Never checked'}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-3">
                          {isAdmin() && (
                            <>
                              <button
                                onClick={() => {
                                  checkSheet(s.id)
                                    .then(() => poll(s.id))
                                    .catch(() => flash('Failed to launch task scanning channel', true));
                                }}
                                disabled={running}
                                className="bg-[#10b981]/15 text-[#34d399] border border-[#10b981]/30 hover:bg-[#10b981]/25 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-40"
                              >
                                {running ? 'Checking...' : 'Check Now'}
                              </button>
                              {cs != null && cs.id === s.id && !showLog && (
                                <button
                                  onClick={() => setShowLog(true)}
                                  className="text-[#818cf8] text-xs font-semibold hover:underline"
                                >
                                  Logs
                                </button>
                              )}
                              <button
                                onClick={() => setSheetToDelete(s.id)}
                                className="text-[#64748b] hover:text-[#f87171] text-xs font-semibold transition-colors"
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {sheets.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center py-12 text-[#64748b] font-medium">
                      No sheets added yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* MODAL: Add Sheet Form */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-[#1a1d27] border border-[#2e3250] rounded-xl shadow-2xl p-6 max-w-xl w-full relative animate-in fade-in zoom-in-95 duration-150 text-[#e2e8f0]">
            <button
              onClick={() => setShowAddModal(false)}
              className="absolute top-4 right-4 text-[#64748b] hover:text-[#e2e8f0] font-bold text-lg"
            >
              ✕
            </button>
            <h2 className="text-base font-bold text-slate-200 mb-1 flex items-center gap-2">
              <span className="text-xl">⚡</span> Add New Google Sheet
            </h2>
            <p className="text-[#64748b] text-[11px] mb-5 leading-normal">
              Register a new project sheet. Please ensure the Google Service Account has reader permissions on the sheet.
            </p>
            <form onSubmit={handleAdd} className="space-y-4">
              <div>
                <label className="block text-[9px] font-bold text-[#64748b] uppercase tracking-wider mb-1">Google Sheet URL *</label>
                <input
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  required
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  className="w-full bg-[#22263a] border border-[#2e3250] rounded-lg px-3 py-2 text-xs text-[#e2e8f0] outline-none focus:border-[#6366f1] placeholder-[#64748b] transition-colors"
                />
              </div>
              <div>
                <label className="block text-[9px] font-bold text-[#64748b] uppercase tracking-wider mb-1">Project Name</label>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. GoDN Korea"
                  className="w-full bg-[#22263a] border border-[#2e3250] rounded-lg px-3 py-2 text-xs text-[#e2e8f0] outline-none focus:border-[#6366f1] placeholder-[#64748b] transition-colors"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[9px] font-bold text-[#64748b] uppercase tracking-wider mb-1">Leader Email</label>
                  <input
                    value={leaderEmail}
                    onChange={e => setLeaderEmail(e.target.value)}
                    placeholder="leader@company.com"
                    type="email"
                    className="w-full bg-[#22263a] border border-[#2e3250] rounded-lg px-3 py-2 text-xs text-[#e2e8f0] outline-none focus:border-[#6366f1] placeholder-[#64748b] transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-bold text-[#64748b] uppercase tracking-wider mb-1">PM Email</label>
                  <input
                    value={pmEmail}
                    onChange={e => setPmEmail(e.target.value)}
                    placeholder="pm@company.com"
                    type="email"
                    className="w-full bg-[#22263a] border border-[#2e3250] rounded-lg px-3 py-2 text-xs text-[#e2e8f0] outline-none focus:border-[#6366f1] placeholder-[#64748b] transition-colors"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[9px] font-bold text-[#64748b] uppercase tracking-wider mb-1">Members (comma-separated emails)</label>
                <textarea
                  value={memberEmails}
                  onChange={e => setMemberEmails(e.target.value)}
                  placeholder="member1@company.com, member2@company.com"
                  rows={2}
                  className="w-full bg-[#22263a] border border-[#2e3250] rounded-lg px-3 py-2 text-xs text-[#e2e8f0] outline-none focus:border-[#6366f1] placeholder-[#64748b] transition-colors resize-none"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="bg-[#22263a] border border-[#2e3250] hover:bg-[#2a2f47] text-[#e2e8f0] px-4.5 py-1.5 rounded-lg text-xs font-semibold transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-[#6366f1] hover:bg-[#818cf8] text-white px-5 py-1.5 rounded-lg text-xs font-semibold transition-all shadow-md"
                >
                  Add & Start Import
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Delete Confirmation */}
      {sheetToDelete !== null && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-[#1a1d27] border border-[#2e3250] rounded-xl shadow-2xl p-6 max-w-sm w-full relative animate-in fade-in zoom-in-95 duration-150 text-[#e2e8f0]">
            <h2 className="text-base font-bold text-slate-200 mb-2 flex items-center gap-2">
              <span className="text-red-400">⚠️</span> Delete Project Sheet
            </h2>
            <p className="text-[#64748b] text-[11px] mb-6 leading-normal">
              Are you sure you want to delete this project sheet? This will permanently remove all analyzed compliance violations. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setSheetToDelete(null)}
                className="bg-[#22263a] border border-[#2e3250] hover:bg-[#2a2f47] text-[#e2e8f0] px-4 py-1.5 rounded-lg text-xs font-semibold transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const id = sheetToDelete;
                  setSheetToDelete(null);
                  try {
                    await deleteSheet(id);
                    reload();
                  } catch {
                    flash('Failed to delete project sheet', true);
                  }
                }}
                className="bg-red-600 hover:bg-red-500 text-white px-5 py-1.5 rounded-lg text-xs font-semibold transition-all shadow-md"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
