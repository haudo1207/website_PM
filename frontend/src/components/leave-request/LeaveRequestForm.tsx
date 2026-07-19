'use client';

import { useMemo, useState } from 'react';
import { LeaveRequestFormValues, LeaveType, leaveTypes, locations, calculateManDay } from '@/lib/leave-request';

interface LeaveRequestFormProps {
  initialValues?: Partial<LeaveRequestFormValues>;
  onSubmit: (values: LeaveRequestFormValues) => void;
  onCancel: () => void;
  submitLabel?: string;
}

const emptyValues: LeaveRequestFormValues = {
  leaveType: 'Work Remotely',
  startDate: '',
  endDate: '',
  reason: '',
  province: 'Hà Nội',
  ward: 'Phúc Tân',
  address: '',
  manDay: 0,
};

export default function LeaveRequestForm({ initialValues, onSubmit, onCancel, submitLabel = 'Submit Request' }: LeaveRequestFormProps) {
  const [formValues, setFormValues] = useState<LeaveRequestFormValues>({
    ...emptyValues,
    ...initialValues,
  });
  const [validationMessage, setValidationMessage] = useState('');

  const selectedProvince = useMemo(() => locations.find((item) => item.province === formValues.province), [formValues.province]);

  const calculatedManDay = useMemo(() => calculateManDay(formValues.startDate, formValues.endDate), [formValues.startDate, formValues.endDate]);

  const isValid = useMemo(() => {
    if (!formValues.reason.trim()) return false;
    if (!formValues.startDate || !formValues.endDate) return false;
    if (!calculatedManDay || calculatedManDay < 1) return false;
    if (calculatedManDay > 7) return false;
    return true;
  }, [calculatedManDay, formValues.endDate, formValues.reason, formValues.startDate]);

  const handleDateChange = (field: 'startDate' | 'endDate', value: string) => {
    const nextValues = { ...formValues, [field]: value };
    setFormValues(nextValues);

    if (!nextValues.startDate || !nextValues.endDate) {
      setValidationMessage('');
      return;
    }

    const start = new Date(nextValues.startDate);
    const end = new Date(nextValues.endDate);
    if (end < start) {
      setValidationMessage('End date cannot be earlier than start date.');
      return;
    }

    const manDay = calculateManDay(nextValues.startDate, nextValues.endDate);
    if (manDay !== null && manDay > 7) {
      setValidationMessage('Leave requests cannot exceed 7 days.');
      return;
    }

    setValidationMessage('');
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!formValues.reason.trim()) {
      setValidationMessage('Reason is required.');
      return;
    }

    if (!formValues.startDate || !formValues.endDate) {
      setValidationMessage('Please select both dates.');
      return;
    }

    const start = new Date(formValues.startDate);
    const end = new Date(formValues.endDate);
    if (end < start) {
      setValidationMessage('End date cannot be earlier than start date.');
      return;
    }

    const manDay = calculateManDay(formValues.startDate, formValues.endDate);
    if (manDay === null || manDay < 1) {
      setValidationMessage('Please select a valid date range.');
      return;
    }

    if (manDay > 7) {
      setValidationMessage('Leave requests cannot exceed 7 days.');
      return;
    }

    const payload: LeaveRequestFormValues = {
      ...formValues,
      manDay,
    };

    onSubmit(payload);
  };

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-[#565e74]">Leave Type</label>
          <select
            value={formValues.leaveType}
            onChange={(event) => setFormValues({ ...formValues, leaveType: event.target.value as LeaveType })}
            className="w-full rounded-lg border border-[#c2c6d6] bg-white px-3 py-2 text-sm text-[#0b1c30] outline-none focus:border-[#0058be]"
          >
            {leaveTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-[#565e74]">Man-day</label>
          <input
            readOnly
            value={calculatedManDay && calculatedManDay > 0 ? `${calculatedManDay} Day${calculatedManDay > 1 ? 's' : ''}` : ''}
            className="w-full rounded-lg border border-[#c2c6d6] bg-[#f8f9ff] px-3 py-2 text-sm text-[#0b1c30] outline-none"
            placeholder="Auto calculated"
          />
        </div>

        <div>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-[#565e74]">Start Date</label>
          <input
            type="date"
            value={formValues.startDate}
            onChange={(event) => handleDateChange('startDate', event.target.value)}
            className="w-full rounded-lg border border-[#c2c6d6] bg-white px-3 py-2 text-sm text-[#0b1c30] outline-none focus:border-[#0058be]"
          />
        </div>

        <div>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-[#565e74]">End Date</label>
          <input
            type="date"
            value={formValues.endDate}
            onChange={(event) => handleDateChange('endDate', event.target.value)}
            className="w-full rounded-lg border border-[#c2c6d6] bg-white px-3 py-2 text-sm text-[#0b1c30] outline-none focus:border-[#0058be]"
          />
        </div>
      </div>

      <div>
        <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-[#565e74]">Reason</label>
        <textarea
          rows={4}
          value={formValues.reason}
          onChange={(event) => setFormValues({ ...formValues, reason: event.target.value })}
          className="w-full rounded-lg border border-[#c2c6d6] bg-white px-3 py-2 text-sm text-[#0b1c30] outline-none focus:border-[#0058be]"
          placeholder="Describe the reason for your leave request"
        />
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-[#565e74]">Province / City</label>
          <select
            value={formValues.province}
            onChange={(event) => {
              const nextProvince = event.target.value;
              const nextWard = locations.find((item) => item.province === nextProvince)?.wards[0] || '';
              setFormValues({ ...formValues, province: nextProvince, ward: nextWard });
            }}
            className="w-full rounded-lg border border-[#c2c6d6] bg-white px-3 py-2 text-sm text-[#0b1c30] outline-none focus:border-[#0058be]"
          >
            {locations.map((item) => (
              <option key={item.province} value={item.province}>
                {item.province}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-[#565e74]">Ward / Commune</label>
          <select
            value={formValues.ward}
            onChange={(event) => setFormValues({ ...formValues, ward: event.target.value })}
            className="w-full rounded-lg border border-[#c2c6d6] bg-white px-3 py-2 text-sm text-[#0b1c30] outline-none focus:border-[#0058be]"
            disabled={!selectedProvince}
          >
            {selectedProvince?.wards.map((ward) => (
              <option key={ward} value={ward}>
                {ward}
              </option>
            ))}
          </select>
        </div>
      </div>

      {validationMessage ? <p className="text-sm font-medium text-rose-600">{validationMessage}</p> : null}

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} className="rounded-lg border border-[#c2c6d6] px-4 py-2 text-sm font-semibold text-[#565e74] transition hover:bg-[#f8f9ff]">
          Cancel
        </button>
        <button type="submit" disabled={!isValid} className="rounded-lg bg-[#0058be] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#004da8] disabled:cursor-not-allowed disabled:bg-slate-300">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
