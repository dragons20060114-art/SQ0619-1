
import React from 'react';
import { LucideIcon, CheckCircle2, AlertCircle } from 'lucide-react';

interface InputFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon: LucideIcon;
  label: string;
}

export const InputField: React.FC<InputFieldProps> = ({ icon: Icon, label, ...props }) => (
  <div className="mb-4">
    <label className="block text-sm font-black text-black mb-1 ml-1 uppercase tracking-wider text-[10px]">{label}</label>
    <div className="relative">
      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-amber-600">
        <Icon size={18} />
      </div>
      <input
        {...props}
        className="block w-full pl-10 pr-4 py-3 bg-white border border-amber-200 rounded-2xl focus:ring-2 focus:ring-amber-500 transition-all duration-200 outline-none font-bold text-black placeholder:text-gray-400"
      />
    </div>
  </div>
);

interface ToastProps {
  message: string;
  type: 'success' | 'error';
}

export const Toast: React.FC<ToastProps> = ({ message, type }) => (
  <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 rounded-full shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-top-4 ${type === 'error' ? 'bg-red-600 text-white' : 'bg-black text-white'}`}>
    {type === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} className="text-amber-400" />}
    <span className="text-sm font-black tracking-wide">{message}</span>
  </div>
);

export const StepIndicator: React.FC<{ currentStep: number }> = ({ currentStep }) => (
  <div className="flex justify-between mb-10 px-4">
    {[1, 2, 3].map((s) => (
      <div key={s} className="flex flex-col items-center">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black transition-all shadow-sm ${currentStep >= s ? 'bg-amber-500 text-white' : 'bg-amber-200 text-amber-600'}`}>{s}</div>
        <span className={`text-[10px] mt-2 font-black uppercase tracking-tighter ${currentStep >= s ? 'text-black' : 'text-gray-500'}`}>
          {s === 1 ? '挑選餐點' : s === 2 ? '個人資訊' : '確認送出'}
        </span>
      </div>
    ))}
  </div>
);
