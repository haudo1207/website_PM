'use client';

import { useEffect, useRef, useState } from 'react';

// Moved out of project/detail/page.tsx (2026-09-20 Calendar Task Detail
// parity pass) into its own module so it's a genuinely shared component
// instead of a page-file export — Next.js's app router only allows a
// page.tsx to export a small fixed set of names (default, metadata, etc.),
// it errors on arbitrary extra named exports. Pure props-in/callback-out,
// no dependency on any page-specific state, so this move is behavior-neutral
// for project/detail/page.tsx's own Remark field.
export interface RemarkMultiSelectInputProps {
  value: string;
  performanceSettings: any[];
  onChange: (newValue: string) => void;
  placeholder?: string;
}

export function RemarkMultiSelectInput({ value, performanceSettings, onChange, placeholder }: RemarkMultiSelectInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const getSelectedIds = (): number[] => {
    if (!value) return [];
    return value.split(',').map(p => p.trim()).filter(Boolean).map(part => {
      if (/^\d+$/.test(part)) {
        return parseInt(part, 10);
      }
      const found = performanceSettings.find(rule => {
        const rulePerf = rule.performance.trim().toLowerCase();
        const cleanRulePerf = rulePerf.startsWith('(t)') || rulePerf.startsWith('(p)')
          ? rulePerf.substring(3).trim()
          : rulePerf;
        const partLower = part.toLowerCase();
        return rulePerf === partLower || cleanRulePerf === partLower;
      });
      return found ? found.id : null;
    }).filter((id): id is number => id !== null);
  };

  const selectedIds = getSelectedIds();

  const getRuleGroup = (performance: string): string => {
    const p = performance.trim().toLowerCase();
    if (p.startsWith('(t)')) return 'I. Tasks khen thưởng';
    if (p.startsWith('(p)')) return 'II. Tasks bị phạt';
    if (p.includes('rework') || p.includes('change request') || p.includes('issue') || p.includes('unplanned')) return 'IV. Tasks phát sinh';
    if (p.includes('xử lý sự cố') || p.includes('ngày lễ') || p.includes('cuối tuần') || p.includes('tối trong tuần') || p.includes('ot') || /^\d+\s*day/.test(p)) return 'III. Tasks làm ngoài giờ';
    return 'IV. Tasks phát sinh';
  };

  const filteredRules = performanceSettings.filter(rule => {
    if (!rule.is_active) return false;
    const term = searchTerm.toLowerCase().trim();
    if (!term) return true;
    return rule.performance.toLowerCase().includes(term);
  });

  const groupedRules: { [key: string]: any[] } = {};
  filteredRules.forEach(rule => {
    const grp = getRuleGroup(rule.performance);
    if (!groupedRules[grp]) groupedRules[grp] = [];
    groupedRules[grp].push(rule);
  });

  const groupOrder = [
    'I. Tasks khen thưởng',
    'II. Tasks bị phạt',
    'III. Tasks làm ngoài giờ',
    'IV. Tasks phát sinh'
  ];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchTerm('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative w-full" ref={containerRef}>
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="w-full min-h-11 bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-[13px] text-[#0b1c30] cursor-pointer flex flex-wrap gap-1 items-center focus:outline-none focus:border-[#0058be] focus:ring-2 focus:ring-[#0058be]/15 shadow-sm hover:border-slate-300 transition-colors"
      >
        {selectedIds.length === 0 ? (
          <span className="text-slate-400 font-medium select-none">{placeholder || 'Chọn Remark...'}</span>
        ) : (
          selectedIds.map(id => {
            const r = performanceSettings.find(rule => rule.id === id);
            if (!r) return null;
            let display = r.performance;
            let badgeStyle = "bg-slate-100 text-slate-700";
            if (display.toLowerCase().startsWith('(t)')) {
              display = '[T] ' + display.substring(3).trim();
              badgeStyle = "bg-emerald-50 text-emerald-700 border border-emerald-200";
            } else if (display.toLowerCase().startsWith('(p)')) {
              if (display.toLowerCase().includes('fail')) {
                display = '[FAIL] ' + display.substring(3).trim();
                badgeStyle = "bg-amber-50 text-amber-700 border border-amber-200";
              } else {
                display = '[P] ' + display.substring(3).trim();
                badgeStyle = "bg-rose-50 text-rose-700 border border-rose-200";
              }
            } else if (display.toLowerCase().includes('xử lý sự cố') || display.toLowerCase().includes('ngày lễ') || display.toLowerCase().includes('cuối tuần') || display.toLowerCase().includes('tối trong tuần') || display.toLowerCase().includes('ot') || /^\d+\s*day/.test(display.toLowerCase())) {
              badgeStyle = "bg-blue-50 text-blue-700 border border-blue-200";
            }
            return (
              <span key={id} className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${badgeStyle}`}>
                {display}
              </span>
            );
          })
        )}
      </div>

      {isOpen && (
        <div className="absolute left-0 mt-1 w-[400px] max-h-[300px] bg-white border border-slate-200 rounded-lg shadow-2xl z-[1050] p-3 flex flex-col gap-2 transition-all animate-fadeIn">
          <input
            type="text"
            value={searchTerm}
            placeholder="Tìm kiếm Remark..."
            autoFocus
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded px-2.5 py-1.5 text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] font-semibold shadow-sm"
          />
          <div className="overflow-y-auto flex-1 max-h-[200px] pr-1 space-y-3">
            {groupOrder.map(groupName => {
              const rules = groupedRules[groupName] || [];
              if (rules.length === 0) return null;
              return (
                <div key={groupName} className="space-y-1">
                  <div className="text-[10px] font-black tracking-wider uppercase text-slate-400 select-none px-1 border-b border-slate-100 pb-0.5 mb-1">
                    {groupName}
                  </div>
                  {rules.map(rule => {
                    const isSelected = selectedIds.includes(rule.id);
                    const kpiVal = parseFloat(rule.kpi);
                    let kpiBadge = null;
                    if (kpiVal > 0) {
                      kpiBadge = (
                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-100">
                          +{kpiVal}
                        </span>
                      );
                    } else if (kpiVal < 0) {
                      kpiBadge = (
                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 border border-rose-100">
                          {kpiVal}
                        </span>
                      );
                    } else if (rule.performance.toLowerCase().includes('fail') || rule.performance.toLowerCase().includes('rework') || (kpiVal > 0 && kpiVal < 1.0)) {
                      kpiBadge = (
                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-100">
                          x{kpiVal}
                        </span>
                      );
                    } else {
                      kpiBadge = (
                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-slate-50 text-slate-400 border border-slate-100">
                          0
                        </span>
                      );
                    }

                    return (
                      <div
                        key={rule.id}
                        onClick={() => {
                          const updated = isSelected
                            ? selectedIds.filter(id => id !== rule.id)
                            : [...selectedIds, rule.id];
                          onChange(updated.join(','));
                        }}
                        className={`group flex items-center justify-between px-2.5 py-1.5 rounded cursor-pointer text-xs font-semibold transition-all duration-150 ${isSelected
                          ? 'bg-[#eff4ff] text-[#0058be]'
                          : 'text-slate-700 hover:bg-slate-50'
                          }`}
                      >
                        <div className="flex items-center gap-2 max-w-[80%]">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            readOnly
                            className="w-3.5 h-3.5 rounded border-slate-300 text-[#0058be] focus:ring-[#0058be] pointer-events-none"
                          />
                          <span className="truncate" title={rule.performance}>
                            {rule.performance}
                          </span>
                        </div>
                        <div className="shrink-0">
                          {kpiBadge}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {Object.keys(groupedRules).length === 0 && (
              <div className="text-center py-6 text-slate-400 text-xs italic font-medium">
                Không tìm thấy remark nào hợp lệ.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
