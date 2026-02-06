
import React from 'react';
import { LucideIcon, CheckCircle2, AlertCircle } from 'lucide-react';

interface InputFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon: LucideIcon;
  label: string;
}

export const InputField: React.FC<InputFieldProps> = ({ icon: Icon, label, ...props }) => (
  <div className="mb-4">
    <label className="block text-sm font-medium text-gray-600 mb-1 ml-1">{label}</label>
    <div className="relative">
      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
        <Icon size={18} />
      </div>
      <input
        {...props}
        className="block w-full pl-10 pr-4 py-3 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-blue-500 transition-all duration-200 outline-none"
      />
    </div>
  </div>
);

interface ToastProps {
  message: string;
  type: 'success' | 'error';
}

export const Toast: React.FC<ToastProps> = ({ message, type }) => (
  <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 rounded-full shadow-2xl flex items-center gap-2 animate-bounce ${type === 'error' ? 'bg-red-500 text-white' : 'bg-black text-white'}`}>
    {type === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
    <span className="text-sm font-medium">{message}</span>
  </div>
);

export const StepIndicator: React.FC<{ currentStep: number }> = ({ currentStep }) => (
  <div className="flex justify-between mb-10 px-4">
    {[1, 2, 3].map((s) => (
      <div key={s} className="flex flex-col items-center">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${currentStep >= s ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-400'}`}>{s}</div>
        <span className={`text-[10px] mt-2 font-medium ${currentStep >= s ? 'text-blue-600' : 'text-gray-400'}`}>
          {s === 1 ? '挑選餐點' : s === 2 ? '個人資訊' : '確認送出'}
        </span>
      </div>
    ))}
  </div>
);
