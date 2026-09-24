'use client';

import { useMemo, useState } from 'react';
import { HOURLY_MAN_DAY, LeaveRequestFormValues, LeaveType, OffMode, leaveTypes, locations, calculateManDay } from '@/lib/leave-request';
import SearchableSelect from '@/components/common/SearchableSelect';

interface LeaveRequestFormProps {
  initialValues?: Partial<LeaveRequestFormValues>;
  onSubmit: (values: LeaveRequestFormValues) => void;
  onCancel: () => void;
  submitLabel?: string;
}

const emptyValues: LeaveRequestFormValues = {
  leaveType: 'Work Remotely',
  offMode: 'day',
  startDate: '',
  endDate: '',
  startTime: '',
  endTime: '',
  reason: '',
  province: 'Hà Nội',
  ward: 'Phúc Tân',
  address: '',
  manDay: 0,
};

const OFF_MODE_OPTIONS: { key: OffMode; label: string }[] = [
  { key: 'day', label: 'OFF theo ngày' },
  { key: 'hour', label: 'OFF theo khung giờ' },
];

export default function LeaveRequestForm({ initialValues, onSubmit, onCancel, submitLabel = 'Submit Request' }: LeaveRequestFormProps) {
  const [formValues, setFormValues] = useState<LeaveRequestFormValues>({
    ...emptyValues,
    ...initialValues,
  });
  const [validationMessage, setValidationMessage] = useState('');

  const isHourly = formValues.offMode === 'hour';
  const selectedProvince = useMemo(() => locations.find((item) => item.province === formValues.province), [formValues.province]);

  // Full-day: existing inclusive-calendar-day count (1 man-day/day).
  // Hourly: fixed 0.5 man-day (business rule) on ONE date.
  const calculatedManDay = useMemo(() => {
    if (isHourly) {
      return formValues.startDate && formValues.startTime && formValues.endTime && formValues.endTime > formValues.startTime
        ? HOURLY_MAN_DAY
        : null;
    }
    return calculateManDay(formValues.startDate, formValues.endDate);
  }, [isHourly, formValues.startDate, formValues.endDate, formValues.startTime, formValues.endTime]);

  const isValid = useMemo(() => {
    if (!formValues.reason.trim()) return false;
    if (!formValues.startDate) return false;
    if (isHourly) {
      if (!formValues.startTime || !formValues.endTime) return false;
      if (formValues.endTime <= formValues.startTime) return false;
      return true;
    }
    if (!formValues.endDate) return false;
    if (!calculatedManDay || calculatedManDay < 1) return false;
    if (calculatedManDay > 7) return false;
    return true;
  }, [calculatedManDay, isHourly, formValues.endDate, formValues.startTime, formValues.endTime, formValues.reason, formValues.startDate]);

  const handleDateChange = (field: 'startDate' | 'endDate', value: string) => {
    const nextValues = { ...formValues, [field]: value };
    setFormValues(nextValues);

    if (nextValues.offMode === 'hour') {
      setValidationMessage('');
      return;
    }

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

  const handleOffModeChange = (mode: OffMode) => {
    setFormValues((prev) => ({ ...prev, offMode: mode }));
    setValidationMessage('');
  };

  const handleTimeChange = (field: 'startTime' | 'endTime', value: string) => {
    const nextValues = { ...formValues, [field]: value };
    setFormValues(nextValues);
    if (nextValues.startTime && nextValues.endTime && nextValues.endTime <= nextValues.startTime) {
      setValidationMessage('Giờ kết thúc phải sau giờ bắt đầu.');
    } else {
      setValidationMessage('');
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!formValues.reason.trim()) {
      setValidationMessage('Reason is required.');
      return;
    }

    if (!formValues.startDate) {
      setValidationMessage('Please select a date.');
      return;
    }

    if (isHourly) {
      if (!formValues.startTime || !formValues.endTime) {
        setValidationMessage('Please select both start and end time.');
        return;
      }
      if (formValues.endTime <= formValues.startTime) {
        setValidationMessage('Giờ kết thúc phải sau giờ bắt đầu.');
        return;
      }
      onSubmit({
        ...formValues,
        // Hourly leave is single-date by design — end date mirrors start date
        // (cross-day hourly is not supported).
        endDate: formValues.startDate,
        manDay: HOURLY_MAN_DAY,
      });
      return;
    }

    if (!formValues.endDate) {
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
      startTime: '',
      endTime: '',
      manDay,
    };

    onSubmit(payload);
  };

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div>
        <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-[#565e74]">Loại nghỉ (OFF)</label>
        <div className="inline-flex rounded-lg border border-[#c2c6d6] bg-white p-0.5">
          {OFF_MODE_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => handleOffModeChange(opt.key)}
              className={`rounded-md px-4 py-2 text-sm font-semibold transition-colors ${
                formValues.offMode === opt.key ? 'bg-[#0058be] text-white' : 'text-[#565e74] hover:bg-[#f8f9ff]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-[#565e74]">Leave Type</label>
          <select
            value={formValues.leaveType}
            onChange={(event) => setFormValues({ ...formValues, leaveType: event.target.value as LeaveType })}
            className="w-full rounded-lg border border-[#c2c6d6] bg-white px-3 py-2 text-sm text-[#0b1c30] outline-none focus:border-[#0058be]"
          >
            {Object.values(leaveTypes).map((type) => (
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
          <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-[#565e74]">
            {isHourly ? 'Ngày nghỉ' : 'Start Date'}
          </label>
          <input
            type="date"
            value={formValues.startDate}
            onChange={(event) => handleDateChange('startDate', event.target.value)}
            className="w-full rounded-lg border border-[#c2c6d6] bg-white px-3 py-2 text-sm text-[#0b1c30] outline-none focus:border-[#0058be]"
          />
        </div>

        {isHourly ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-[#565e74]">Từ giờ</label>
              <input
                type="time"
                value={formValues.startTime}
                onChange={(event) => handleTimeChange('startTime', event.target.value)}
                className="w-full rounded-lg border border-[#c2c6d6] bg-white px-3 py-2 text-sm text-[#0b1c30] outline-none focus:border-[#0058be]"
              />
            </div>
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-[#565e74]">Đến giờ</label>
              <input
                type="time"
                value={formValues.endTime}
                min={formValues.startTime || undefined}
                onChange={(event) => handleTimeChange('endTime', event.target.value)}
                className="w-full rounded-lg border border-[#c2c6d6] bg-white px-3 py-2 text-sm text-[#0b1c30] outline-none focus:border-[#0058be]"
              />
            </div>
          </div>
        ) : (
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-[#565e74]">End Date</label>
            <input
              type="date"
              value={formValues.endDate}
              onChange={(event) => handleDateChange('endDate', event.target.value)}
              className="w-full rounded-lg border border-[#c2c6d6] bg-white px-3 py-2 text-sm text-[#0b1c30] outline-none focus:border-[#0058be]"
            />
          </div>
        )}
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
          <SearchableSelect
            label="Tỉnh/Thành"
            icon=""
            options={locations.map((item) => item.province)}
            value={formValues.province}
            onChange={(val: any) => {
              // Province is always required — ignore the built-in "reset" option.
              if (val === 'all') return;
              const nextWard = locations.find((item) => item.province === val)?.wards[0] || '';
              setFormValues({ ...formValues, province: val, ward: nextWard });
            }}
            placeholder="Tìm tỉnh/thành..."
            className="w-full"
          />
        </div>

        <div>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-[#565e74]">Ward / Commune</label>
          <SearchableSelect
            label="Phường/Xã"
            icon=""
            options={selectedProvince?.wards || []}
            value={formValues.ward}
            onChange={(val: any) => {
              // Ward is always required — ignore the built-in "reset" option.
              if (val === 'all') return;
              setFormValues({ ...formValues, ward: val });
            }}
            placeholder="Tìm phường/xã..."
            disabled={!selectedProvince}
            className="w-full"
          />
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
