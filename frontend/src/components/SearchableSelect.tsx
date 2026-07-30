'use client';
import { useState, useRef, useEffect } from 'react';

interface SearchableSelectProps {
  options: { id: any; name: string }[];
  value: any;
  onChange: (value: any) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}

export default function SearchableSelect({
  options,
  value,
  onChange,
  onKeyDown,
  onBlur,
  placeholder = 'Search...',
  className,
  autoFocus,
}: SearchableSelectProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(opt => opt.id === value);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        if (onBlur) onBlur();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [wrapperRef, onBlur]);

  const filteredOptions = options.filter(option =>
    option.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSelect = (optionId: any) => {
    onChange(optionId);
    setSearchTerm('');
    setIsOpen(false);
  };

  return (
    <div className="relative w-full" ref={wrapperRef}>
      <div
        className={`w-full bg-white border rounded px-1 py-0.5 text-xs text-[#0b1c30] focus:outline-none font-semibold cursor-pointer flex justify-between items-center ${className} ${isOpen ? 'border-[#0058be]' : 'border-gray-300'}`}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span>{selectedOption?.name || placeholder}</span>
        <span>{isOpen ? '▲' : '▼'}</span>
      </div>

      {isOpen && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
          <div className="p-2">
            <input
              type="text"
              placeholder="Search..."
              className="w-full px-2 py-1 border border-gray-300 rounded-md text-xs"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              autoFocus={autoFocus}
            />
          </div>
          <ul>
            {placeholder && !selectedOption && (
                <li
                    className="px-3 py-2 text-xs text-gray-500 cursor-pointer hover:bg-gray-100"
                    onMouseDown={() => handleSelect('')}
                >
                    {placeholder}
                </li>
            )}
            {filteredOptions.map(option => (
              <li
                key={option.id}
                className="px-3 py-2 text-xs cursor-pointer hover:bg-gray-100"
                onMouseDown={() => handleSelect(option.id)}
              >
                {option.name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
