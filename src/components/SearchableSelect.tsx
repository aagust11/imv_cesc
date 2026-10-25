import React, { useState, useEffect, useRef } from "react";
import { Search, ChevronDown, Check, X } from "lucide-react";

interface SearchableSelectProps {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  masked?: boolean;
  disabled?: boolean;
  id?: string;
  excludeOptions?: string[]; // E.g., don't show self or already chosen in other dropdowns
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder,
  masked = false,
  disabled = false,
  id = "searchable-select",
  excludeOptions = []
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Filter options based on search query
  const availableOptions = options.filter(
    (opt) => !excludeOptions.includes(opt)
  );

  const filteredOptions = searchTerm
    ? availableOptions.filter((opt) =>
        opt.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : availableOptions;

  const handleSelect = (option: string) => {
    onChange(option);
    setIsOpen(false);
    setSearchTerm("");
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("");
    setSearchTerm("");
  };

  // Mask string representation
  const renderValue = () => {
    if (!value) return "";
    if (masked) return "••••••••";
    return value;
  };

  return (
    <div ref={containerRef} className="relative w-full" id={id}>
      <div
        onClick={() => {
          if (!disabled) {
            setIsOpen(!isOpen);
            setSearchTerm("");
          }
        }}
        className={`flex items-center justify-between w-full h-11 px-3 border-2 border-slate-900 cursor-pointer transition-all duration-200 bg-white shadow-[2px_2px_0px_rgba(0,0,0,1)]
          ${disabled ? "bg-slate-100 border-slate-300 cursor-not-allowed text-slate-400 shadow-none" : "hover:bg-slate-50"}
          ${isOpen ? "bg-indigo-50" : ""}
        `}
      >
        <div className="flex-1 overflow-hidden">
          {value ? (
            <span className={`block truncate ${masked ? "text-slate-700 font-mono tracking-widest font-bold text-sm" : "text-slate-900 font-bold"}`}>
              {renderValue()}
            </span>
          ) : (
            <span className="text-slate-500 truncate text-sm font-semibold">{placeholder}</span>
          )}
        </div>

        <div className="flex items-center gap-1.5 ml-2">
          {value && !disabled && (
            <button
              type="button"
              onClick={handleClear}
              className="p-1 rounded bg-slate-105 border border-slate-300 text-slate-800 hover:bg-rose-100 hover:text-rose-700 transition-colors"
              title="Netejar"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <ChevronDown className={`w-4 h-4 text-slate-900 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
        </div>
      </div>

      {isOpen && !disabled && (
        <div className="absolute z-50 w-full mt-1 bg-white border-2 border-slate-900 shadow-[4px_4px_0px_rgba(0,0,0,1)] max-h-60 overflow-hidden flex flex-col">
          <div className="flex items-center px-3 py-1.5 border-b-2 border-slate-900 bg-slate-100">
            <Search className="w-4 h-4 text-slate-900 mr-2 shrink-0" />
            <input
              type="text"
              autoFocus
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Escriu per cercar..."
              className="w-full py-1 text-sm bg-transparent border-none outline-none text-slate-900 placeholder:text-slate-500 font-bold"
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          <div className="overflow-y-auto flex-1 py-1 max-h-48">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option, idx) => (
                <div
                  key={idx}
                  onClick={() => handleSelect(option)}
                  className={`flex items-center justify-between px-3 py-2 text-sm cursor-pointer transition-colors border-b border-slate-100 hover:bg-indigo-100 font-bold
                    ${value === option ? "bg-indigo-250 text-slate-950 font-black text-indigo-700" : "text-slate-800"}
                  `}
                >
                  <span className="truncate">{option}</span>
                  {value === option && <Check className="w-4 h-4 text-indigo-650" />}
                </div>
              ))
            ) : (
              <div className="px-4 py-3 text-xs text-center text-slate-500 italic font-bold">
                No s'han trobat alumnes
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
