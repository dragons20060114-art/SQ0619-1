
import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { 
  Plus, 
  Minus,
  Trash2, 
  Download, 
  ClipboardCheck, 
  User, 
  IdCard, 
  Phone,
  ShoppingCart,
  History,
  Loader2,
  ChevronRight,
  Camera,
  MessageSquare,
  StickyNote,
  CirclePlus,
  Sparkles,
  ChevronLeft,
  Share2,
  PackagePlus,
  BarChart3,
  Copy,
  LayoutTemplate,
  CheckCircle2,
  QrCode,
  Zap,
  Tag,
  ListOrdered,
  Cloud,
  CloudSync,
  RefreshCw,
  Wifi,
  WifiOff,
  Send,
  Link
} from 'lucide-react';
import { OrderItem, UserInfo, OrderHistoryEntry, Step } from './types';
import { analyzeMenuContent } from './services/geminiService';
import { InputField, Toast, StepIndicator } from './components/UI';

const generateId = () => Math.random().toString(36).substring(2, 11) + Date.now().toString(36);

/**
 * 雲端中繼服務 (npoint.io) - 比 JSONBlob 更穩定且不會被瀏覽器擋掉 Location 標頭
 */
const CLOUD_API = "https://api.npoint.io";

const cloudService = {
  // 建立新房間
  async createRoom(menu: any) {
    try {
      const response = await fetch(CLOUD_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ menu, orders: [] })
      });
      if (!response.ok) throw new Error("Cloud service returned " + response.status);
      const data = await response.json();
      return data.id; // npoint 直接在 body 回傳 id
    } catch (e) {
      console.error("Create Room Error:", e);
      return null;
    }
  },
  // 獲取房間資料
  async getRoom(id: string) {
    const response = await fetch(`${CLOUD_API}/${id}`);
    if (!response.ok) throw new Error("Room not found");
    return await response.json();
  },
  // 送出訂單 (自動回傳)
  async submitToRoom(id: string, newOrder: any) {
    const currentData = await this.getRoom(id);
    // 檢查是否重複 (同人同時間)
    const exists = currentData.orders.some((o: any) => o.timestamp === newOrder.timestamp && o.empName === newOrder.empName);
    if (exists) return currentData;
    
    currentData.orders.push(newOrder);
    const response = await fetch(`${CLOUD_API}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentData)
    });
    return await response.json();
  }
};

/**
 * 壓縮工具 (手動備援模式)
 */
const shrink = {
  async compress(data: any): Promise<string> {
    const minified = Array.isArray(data) 
      ? data.map(i => ({ n: i.name, p: i.price, nt: i.note, h: i.hasAddon, an: i.addonName, ap: i.addonPrice }))
      : { id: data.empId, nm: data.empName, ph: data.phone, on: data.orderNote, t: data.total, ts: data.timestamp, i: data.items.map((it: any) => ({ n: it.name, p: it.price, nt: it.note, h: it.hasAddon, an: it.addonName, ap: it.addonPrice, q: it.quantity })) };
    const json = JSON.stringify(minified);
    const stream = new Blob([json]).stream();
    const compressedStream = stream.pipeThrough(new CompressionStream('gzip'));
    const response = new Response(compressedStream);
    const buffer = await response.arrayBuffer();
    const uint8 = new Uint8Array(buffer);
    let binary = "";
    uint8.forEach(b => binary += String.fromCharCode(b));
    return btoa(binary);
  },
  async decompress(base64: string): Promise<any> {
    try {
      let clean = base64.replace(/\s/g, '').replace(/[\u200b-\u200d\uFEFF]/g, '').replace(/^["']|["']$/g, '').replace(/[^A-Za-z0-9\+\/\=]/g, '');
      while (clean.length % 4 !== 0) clean += '=';
      const binary = atob(clean);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const stream = new Blob([bytes]).stream();
      const decompressedStream = stream.pipeThrough(new DecompressionStream('gzip'));
      const text = await new Response(decompressedStream).text();
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.map(i => ({ name: i.n, price: i.p, note: i.nt, hasAddon: i.h, addonName: i.an, addonPrice: i.ap }));
      } else {
        return { empId: parsed.id, empName: parsed.nm, phone: parsed.ph, orderNote: parsed.on, total: parsed.t, timestamp: parsed.ts, items: parsed.i.map((it: any) => ({ name: it.n, price: it.p, note: it.nt, hasAddon: it.h, addonName: it.an, addonPrice: it.ap, quantity: it.q })) };
      }
    } catch (e) { throw new Error("解析失敗"); }
  }
};

const App: React.FC = () => {
  const [step, setStep] = useState<Step>(Step.Selection);
  const [isLoading, setIsLoading] = useState(false);
  const [isAiAnalyzing, setIsAiAnalyzing] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [importText, setImportText] = useState('');
  const [templateCode, setTemplateCode] = useState('');
  const [showTemplateInput, setShowTemplateInput] = useState(false);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [isCloudActive, setIsCloudActive] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [userInfo, setUserInfo] = useState<UserInfo>({ empId: '', empName: '', phone: '', orderNote: '' });
  const [items, setItems] = useState<OrderItem[]>([{ id: generateId(), name: '', price: '', note: '', quantity: 0, hasAddon: false, addonName: '', addonPrice: '' }]);
  const [history, setHistory] = useState<OrderHistoryEntry[]>([]);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // 雲端輪詢機制
  useEffect(() => {
    let timer: number;
    if (step === Step.History && roomId && isCloudActive) {
      const poll = async () => {
        try {
          const data = await cloudService.getRoom(roomId);
          if (data.orders && JSON.stringify(data.orders) !== JSON.stringify(history)) {
            setHistory(data.orders);
            setLastSync(new Date());
          }
        } catch (e) { console.error("輪詢失敗", e); }
      };
      timer = window.setInterval(poll, 6000);
    }
    return () => clearInterval(timer);
  }, [step, roomId, isCloudActive, history]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsAiAnalyzing(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64Data = (reader.result as string).split(',')[1];
        try {
          const orders = await analyzeMenuContent(base64Data, file.type);
          if (orders.length > 0) {
            const newItems: OrderItem[] = orders.map(order => ({
              id: generateId(), name: order.name, price: order.price.toString(), note: order.note || '', quantity: 0, hasAddon: false, addonName: '', addonPrice: ''
            }));
            setItems(newItems);
            showToast(`成功辨識 ${orders.length} 個品項`);
          } else { showToast('未能識別內容', 'error'); }
        } catch (err) { showToast('辨識服務暫時不可用', 'error'); }
        finally { setIsAiAnalyzing(false); }
      };
      reader.readAsDataURL(file);
    } catch (error) { showToast('檔案讀取失敗', 'error'); setIsAiAnalyzing(false); }
  };

  const generateMenuTemplate = async () => {
    const menuTemplate = items.filter(i => i.name).map(i => ({
      name: i.name, price: i.price, note: i.note, hasAddon: i.hasAddon, addonName: i.addonName, addonPrice: i.addonPrice
    }));
    if (menuTemplate.length === 0) { showToast('請先建立菜單', 'error'); return; }
    
    try {
      setIsLoading(true);
      const code = await shrink.compress(menuTemplate);
      navigator.clipboard.writeText(`MENU:${code}`);
      showToast('手動分享代碼已複製！可貼給 LINE 同事');
    } catch (e) { showToast('代碼生成失敗', 'error'); }
    finally { setIsLoading(false); }
  };

  const openCloudRoom = async () => {
    const menuTemplate = items.filter(i => i.name).map(i => ({
      name: i.name, price: i.price, note: i.note, hasAddon: i.hasAddon, addonName: i.addonName, addonPrice: i.addonPrice
    }));
    if (menuTemplate.length === 0) { showToast('請先建立菜單', 'error'); return; }
    
    setIsLoading(true);
    try {
      const id = await cloudService.createRoom(menuTemplate);
      if (id) {
        setRoomId(id);
        setIsCloudActive(true);
        navigator.clipboard.writeText(id);
        showToast('雲端自動同步已開啟！代碼已複製');
      } else {
        showToast('雲端服務異常，請稍後再試', 'error');
      }
    } catch (e) { 
      console.error(e);
      showToast('雲端連線失敗', 'error'); 
    }
    finally { setIsLoading(false); }
  };

  const handleLoadTemplate = async () => {
    const rawInput = templateCode.trim();
    if (!rawInput) return;
    setIsLoading(true);
    try {
      // 判定為 npoint ID (通常為英數組合且長度較短)
      if (rawInput.length < 25 && !rawInput.includes(':')) {
        const data = await cloudService.getRoom(rawInput);
        const newItems = data.menu.map((i: any) => ({ ...i, id: generateId(), quantity: 0 }));
        setItems(newItems);
        setRoomId(rawInput);
        setIsCloudActive(true);
        showToast('已同步雲端菜單！點餐後會自動回傳');
      } else {
        const parts = rawInput.split(/MENU:/i);
        const base64Part = parts[parts.length - 1];
        const decoded = await shrink.decompress(base64Part);
        const newItems = decoded.map((i: any) => ({ ...i, id: generateId(), quantity: 0 }));
        setItems(newItems);
        setIsCloudActive(false);
        setRoomId(null);
        showToast('手動代碼載入成功！');
      }
      setTemplateCode('');
      setShowTemplateInput(false);
    } catch (e) { showToast('代碼無效或過期', 'error'); }
    finally { setIsLoading(false); }
  };

  const updateQuantity = (id: string, delta: number) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, quantity: Math.max(0, item.quantity + delta) } : item));
  };

  const updateItem = (id: string, field: keyof OrderItem, value: any) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, [field]: value } : item));
  };

  const totalPrice = useMemo(() => {
    return items.reduce((sum, item) => {
      const price = parseFloat(item.price) || 0;
      const addonPrice = item.hasAddon ? (parseFloat(item.addonPrice) || 0) : 0;
      return sum + ((price + addonPrice) * item.quantity);
    }, 0);
  }, [items]);

  const handleSubmit = async () => {
    setIsLoading(true);
    const activeItems = items.filter(item => item.name && item.quantity > 0);
    const orderData: OrderHistoryEntry = {
      ...userInfo, items: activeItems.map(i => ({...i})), total: totalPrice, timestamp: new Date().toISOString()
    };
    
    try {
      if (isCloudActive && roomId) {
        await cloudService.submitToRoom(roomId, orderData);
        showToast('訂單已自動同步回傳！');
      }
      setHistory(prev => [orderData, ...prev]);
      setStep(Step.Success);
    } catch (e) { 
      showToast('雲端傳送失敗，請改用複製代碼', 'error'); 
      setStep(Step.Success);
    }
    finally { setIsLoading(false); }
  };

  const handleImportOrder = async () => {
    if (!importText.trim()) return;
    try {
      const decoded = await shrink.decompress(importText);
      setHistory(prev => [decoded, ...prev]);
      setImportText('');
      showToast('訂單匯入成功！');
    } catch (e) { showToast('解析代碼失敗', 'error'); }
  };

  const aggregateStats = useMemo(() => {
    const stats: { [key: string]: { qty: number, total: number, details: string[] } } = {};
    history.forEach(order => {
      order.items.forEach(item => {
        const key = `${item.name}${item.hasAddon && item.addonName ? `+${item.addonName}` : ''}${item.note ? `(${item.note})` : ''}`;
        if (!stats[key]) stats[key] = { qty: 0, total: 0, details: [] };
        stats[key].qty += item.quantity;
        const unitPrice = (parseFloat(item.price) || 0) + (item.hasAddon ? (parseFloat(item.addonPrice) || 0) : 0);
        stats[key].total += unitPrice * item.quantity;
        stats[key].details.push(`${order.empName} x${item.quantity}`);
      });
    });
    return stats;
  }, [history]);

  return (
    <div className="min-h-screen bg-[#F5F5F7] text-[#1D1D1F] p-4 md:p-8 flex flex-col items-center">
      {(isAiAnalyzing || isLoading) && (
        <div className="fixed inset-0 bg-white/70 backdrop-blur-md z-[100] flex flex-col items-center justify-center">
          <div className="w-16 h-16 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin"></div>
          <p className="mt-4 font-bold text-blue-600 animate-pulse">連線處理中...</p>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} />}

      <div className="w-full max-w-2xl">
        <header className="mb-8 text-center animate-in slide-in-from-top-4">
          <h1 className="text-4xl font-black tracking-tight mb-2 bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-600">QuickBite</h1>
          <p className="text-gray-500 font-medium text-[10px] tracking-[0.2em] uppercase">Office Lunch Ordering Mastery</p>
          
          {isCloudActive && roomId && (
            <div className="mt-4 inline-flex items-center gap-3 bg-blue-50 px-4 py-2 rounded-full border border-blue-100 shadow-sm">
              <Wifi size={14} className="text-blue-500 animate-pulse" />
              <span className="text-[11px] font-black text-blue-600 uppercase tracking-wider">雲端房間: {roomId}</span>
            </div>
          )}
        </header>

        <div className="bg-white rounded-[2.5rem] shadow-2xl shadow-blue-900/5 border border-white p-6 md:p-10 mb-8 relative overflow-hidden">
          {step <= 3 && <StepIndicator currentStep={step} />}

          {step === Step.Selection && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex flex-col gap-4 mb-8">
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => fileInputRef.current?.click()} className="flex flex-col items-center justify-center gap-2 p-4 bg-blue-600 text-white rounded-[2rem] hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 active:scale-95">
                    <div className="bg-white/20 p-2 rounded-xl"><Camera size={24} /></div>
                    <span className="text-sm font-black">拍照辨識</span>
                  </button>
                  <button onClick={() => setShowTemplateInput(!showTemplateInput)} className={`flex flex-col items-center justify-center gap-2 p-4 rounded-[2rem] border-2 transition-all active:scale-95 ${showTemplateInput ? 'bg-indigo-50 border-indigo-200 text-indigo-600' : 'bg-white border-gray-100 text-gray-600 hover:border-indigo-100'}`}>
                    <div className={`${showTemplateInput ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-400'} p-2 rounded-xl transition-colors`}><QrCode size={24} /></div>
                    <span className="text-sm font-black">載入菜單</span>
                  </button>
                </div>

                {showTemplateInput && (
                  <div className="p-4 bg-indigo-50 rounded-3xl border border-indigo-100 animate-in slide-in-from-top-4">
                    <div className="flex gap-2">
                      <input placeholder="輸入代碼或貼上分享連結..." className="flex-1 bg-white border border-indigo-200 rounded-xl px-4 py-3 text-xs outline-none focus:ring-2 focus:ring-indigo-400 font-black" value={templateCode} onChange={(e) => setTemplateCode(e.target.value)} />
                      <button onClick={handleLoadTemplate} className="bg-indigo-600 text-white px-6 rounded-xl font-bold text-sm hover:bg-indigo-700">載入</button>
                    </div>
                  </div>
                )}
              </div>

              <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileUpload} />

              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-black flex items-center gap-3 text-gray-800">
                  <div className="bg-blue-100 p-2 rounded-xl text-blue-600"><ShoppingCart size={20} /></div>
                  挑選餐點
                </h2>
                <button onClick={() => setItems([...items, { id: generateId(), name: '', price: '', note: '', quantity: 0, hasAddon: false, addonName: '', addonPrice: '' }])} className="text-[10px] bg-gray-100 text-gray-500 px-4 py-2 rounded-full font-black hover:bg-gray-200 flex items-center gap-1 uppercase">
                  <Plus size={14} /> 手動增加
                </button>
              </div>

              <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar pb-4">
                {items.length === 0 || (items.length === 1 && !items[0].name) ? (
                  <div className="text-center py-16 border-2 border-dashed border-gray-100 rounded-[2.5rem]">
                    <Zap size={40} className="mx-auto opacity-10 mb-4" />
                    <p className="text-sm text-gray-300 font-black">請先辨識或由主辦人載入菜單</p>
                  </div>
                ) : (
                  items.map((item) => (
                    <div key={item.id} className="p-5 bg-white rounded-[2rem] border border-gray-100 shadow-sm transition-all hover:shadow-md hover:border-blue-100 group">
                      <div className="grid grid-cols-12 gap-3 items-center mb-4">
                        <div className="col-span-12 md:col-span-6">
                          <input placeholder="品項名稱" className="w-full bg-gray-50 border-none rounded-xl px-4 py-3 text-sm font-black focus:ring-2 focus:ring-blue-100" value={item.name} onChange={(e) => updateItem(item.id, 'name', e.target.value)} />
                        </div>
                        <div className="col-span-6 md:col-span-3 flex items-center bg-blue-50/50 rounded-xl p-1 border border-blue-100">
                          <button onClick={() => updateQuantity(item.id, -1)} className="w-8 h-8 flex items-center justify-center text-blue-600 hover:bg-white rounded-lg transition-colors"><Minus size={16} /></button>
                          <span className={`flex-1 text-center font-black ${item.quantity > 0 ? 'text-blue-600' : 'text-gray-300'}`}>{item.quantity}</span>
                          <button onClick={() => updateQuantity(item.id, 1)} className="w-8 h-8 flex items-center justify-center text-blue-600 hover:bg-white rounded-lg transition-colors"><Plus size={16} /></button>
                        </div>
                        <div className="col-span-6 md:col-span-3 relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                          <input type="number" placeholder="0" className="w-full bg-gray-50 border-none rounded-xl pl-6 pr-4 py-3 text-sm text-right font-mono font-black" value={item.price} onChange={(e) => updateItem(item.id, 'price', e.target.value)} />
                        </div>
                      </div>

                      {item.hasAddon && (
                        <div className="mb-4 p-3 bg-orange-50/50 rounded-2xl border border-orange-100 flex items-center gap-3 animate-in slide-in-from-top-2 duration-200">
                          <Tag size={14} className="text-orange-400 shrink-0" />
                          <input placeholder="加料內容" className="flex-1 bg-white border border-orange-100 rounded-lg px-3 py-2 text-[11px] font-black outline-none" value={item.addonName} onChange={(e) => updateItem(item.id, 'addonName', e.target.value)} />
                          <div className="relative w-20">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-orange-300 text-[10px]">$</span>
                            <input type="number" placeholder="0" className="w-full bg-white border border-orange-100 rounded-lg pl-5 pr-2 py-2 text-[11px] text-right font-mono font-black outline-none" value={item.addonPrice} onChange={(e) => updateItem(item.id, 'addonPrice', e.target.value)} />
                          </div>
                        </div>
                      )}

                      <div className="flex gap-2">
                        <button onClick={() => updateItem(item.id, 'hasAddon', !item.hasAddon)} className={`text-[10px] px-3 py-2 rounded-full font-black transition-all ${item.hasAddon ? 'bg-orange-500 text-white shadow-md' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'}`}>
                          {item.hasAddon ? '取消加點' : '+加點/加料'}
                        </button>
                        <div className="flex-1 flex items-center gap-2 bg-red-50/30 px-3 py-1.5 rounded-xl border border-dashed border-red-100">
                          <MessageSquare size={12} className="text-red-300" />
                          <input placeholder="備註 (去冰微糖)" className="w-full bg-transparent border-none p-0 text-[11px] text-red-600 font-black placeholder:text-red-200 outline-none" value={item.note} onChange={(e) => updateItem(item.id, 'note', e.target.value)} />
                        </div>
                        <button onClick={() => setItems(items.filter(i => i.id !== item.id))} className="text-gray-200 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"><Trash2 size={16} /></button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="mt-8 pt-8 border-t border-gray-100">
                <div className="mb-6">
                  <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest mb-3 ml-1">發起人分享菜單</p>
                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={openCloudRoom} className="flex items-center justify-center gap-2 px-4 py-4 bg-indigo-600 text-white rounded-[1.5rem] font-black text-xs shadow-xl shadow-indigo-100 hover:scale-[1.02] active:scale-95 transition-all">
                      <CloudSync size={16} /> 開啟雲端自動同步
                    </button>
                    <button onClick={generateMenuTemplate} className="flex items-center justify-center gap-2 px-4 py-4 bg-white border-2 border-indigo-100 text-indigo-600 rounded-[1.5rem] font-black text-xs shadow-sm hover:border-indigo-200 active:scale-95 transition-all">
                      <Copy size={16} /> 複製手動代碼
                    </button>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row justify-between items-center gap-6 bg-gray-50/50 p-6 rounded-[2rem]">
                  <div className="text-left w-full sm:w-auto">
                    <p className="text-[10px] text-gray-400 font-black mb-1">小計</p>
                    <p className="text-3xl font-black text-blue-600 font-mono">${totalPrice}</p>
                  </div>
                  <button onClick={() => items.some(i => i.quantity > 0) ? setStep(Step.UserInfo) : showToast('請先選擇餐點', 'error')} className="w-full sm:w-auto px-12 py-5 bg-black text-white rounded-[1.5rem] font-black shadow-2xl flex items-center justify-center gap-2 hover:translate-x-1 transition-all">
                    下一步 <ChevronRight size={20} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {step === Step.UserInfo && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <h2 className="text-2xl font-black mb-8 flex items-center gap-3">
                <div className="bg-blue-100 p-2 rounded-xl text-blue-600"><User size={24} /></div>
                個人資訊
              </h2>
              <InputField icon={IdCard} label="員工編號 (選填)" placeholder="例如: TW12345" value={userInfo.empId} onChange={(e) => setUserInfo({...userInfo, empId: e.target.value})} />
              <InputField icon={User} label="姓名 (必填)" placeholder="例如: 王小明" value={userInfo.empName} onChange={(e) => setUserInfo({...userInfo, empName: e.target.value})} />
              <InputField icon={Phone} label="聯絡電話" placeholder="例如: 0912345678" type="tel" value={userInfo.phone} onChange={(e) => setUserInfo({...userInfo, phone: e.target.value})} />
              <div className="mt-8 bg-blue-50/40 p-6 rounded-[2rem] border border-blue-100">
                <div className="flex items-center gap-3 mb-3 text-blue-600 font-black text-xs uppercase tracking-widest"><StickyNote size={18} /> 全單總備註</div>
                <textarea placeholder="對主辦人的特別交代..." className="w-full bg-transparent border-none p-0 focus:ring-0 text-sm h-20 outline-none resize-none font-bold" value={userInfo.orderNote} onChange={(e) => setUserInfo({...userInfo, orderNote: e.target.value})} />
              </div>
              <div className="flex gap-4 mt-10">
                <button onClick={() => setStep(Step.Selection)} className="flex-1 bg-gray-100 text-gray-600 py-5 rounded-2xl font-black hover:bg-gray-200 transition-all flex items-center justify-center gap-2"><ChevronLeft size={20} /> 上一步</button>
                <button onClick={() => userInfo.empName ? setStep(Step.Review) : showToast('請填寫姓名', 'error')} className="flex-[2] bg-blue-600 text-white py-5 rounded-2xl font-black shadow-xl shadow-blue-200 flex items-center justify-center gap-2 hover:bg-blue-700 transition-all">確認內容 <ChevronRight size={20} /></button>
              </div>
            </div>
          )}

          {step === Step.Review && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <h2 className="text-2xl font-black mb-6 flex items-center gap-3 text-gray-800">
                <div className="bg-blue-100 p-2 rounded-xl text-blue-600"><ClipboardCheck size={24} /></div>
                點單確認
              </h2>
              <div className="bg-gray-50 rounded-[2.5rem] p-8 mb-8 border border-gray-100">
                <div className="flex justify-between items-start mb-8 pb-6 border-b border-gray-200">
                  <div>
                    <p className="text-[10px] text-gray-400 font-black uppercase mb-1">訂購人</p>
                    <p className="font-black text-xl text-gray-800">{userInfo.empName} <span className="text-gray-400 font-normal text-sm">{userInfo.empId && `(${userInfo.empId})`}</span></p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-gray-400 font-black uppercase mb-1">總計</p>
                    <p className="font-black text-2xl text-blue-600 font-mono">${totalPrice}</p>
                  </div>
                </div>
                <div className="space-y-4 mb-8">
                  {items.filter(i => i.quantity > 0).map((item, idx) => (
                    <div key={idx} className="flex justify-between items-center text-sm">
                      <div className="flex flex-col">
                        <span className="font-black text-gray-700 text-base">{item.name}</span>
                        <div className="flex gap-2 text-[10px] font-bold">
                          {item.hasAddon && <span className="text-orange-500">+{item.addonName}(${item.addonPrice})</span>}
                          {item.note && <span className="text-red-500 italic">備註: {item.note}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="font-black text-blue-600 px-3 py-1 bg-blue-50 rounded-lg text-base">x{item.quantity}</span>
                        <span className="font-mono text-gray-400 w-16 text-right font-black">${(parseFloat(item.price) + (item.hasAddon ? parseFloat(item.addonPrice) : 0)) * item.quantity}</span>
                      </div>
                    </div>
                  ))}
                </div>
                {userInfo.orderNote && (
                  <div className="p-4 bg-blue-50/50 rounded-2xl border border-blue-100">
                    <p className="text-[10px] text-blue-400 font-black mb-1 uppercase">全單總備註</p>
                    <p className="text-sm font-bold text-blue-800">{userInfo.orderNote}</p>
                  </div>
                )}
              </div>
              <button onClick={handleSubmit} disabled={isLoading} className="w-full bg-blue-600 text-white py-6 rounded-3xl font-black text-xl shadow-2xl shadow-blue-200 flex items-center justify-center gap-3 hover:bg-blue-700 transition-all active:scale-95">
                {isLoading ? <Loader2 className="animate-spin" /> : <><Send size={24} /> {isCloudActive ? '確認並自動回傳' : '送出訂單'}</>}
              </button>
            </div>
          )}

          {step === Step.Success && (
            <div className="text-center py-10 animate-in zoom-in-95">
              <div className="w-24 h-24 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-8 shadow-inner"><CheckCircle2 size={48} /></div>
              <h2 className="text-3xl font-black mb-4 text-gray-800">{isCloudActive ? '已傳送雲端！' : '點單完成！'}</h2>
              <p className="text-gray-400 mb-10 text-sm max-w-xs mx-auto font-black leading-relaxed">{isCloudActive ? '主辦人已同步收到您的點單。' : '請複製下方的個人壓縮代碼，貼回 LINE 給主辦人。'}</p>
              
              <div className="flex flex-col gap-4 max-w-sm mx-auto">
                <button onClick={async () => { const code = await shrink.compress(history[0]); navigator.clipboard.writeText(code); showToast('壓縮代碼已複製！'); }} className="bg-blue-600 text-white py-5 px-10 rounded-[2rem] font-black shadow-2xl shadow-blue-200 flex items-center justify-center gap-3 hover:bg-blue-700 active:scale-95 transition-all w-full">
                  <Copy size={24} /> 複製手動代碼 (備援)
                </button>
                <button onClick={() => { setItems([{ id: generateId(), name: '', price: '', note: '', quantity: 0, hasAddon: false, addonName: '', addonPrice: '' }]); setUserInfo({...userInfo, orderNote: ''}); setStep(Step.Selection); }} className="mt-8 text-gray-400 text-sm font-black hover:text-black transition-colors uppercase tracking-widest">再點一份</button>
              </div>
            </div>
          )}

          {step === Step.History && (
            <div className="animate-in fade-in duration-500">
              <div className="flex justify-between items-center mb-8">
                <h2 className="text-2xl font-black flex items-center gap-3 text-gray-800">
                  <div className="bg-blue-100 p-2 rounded-xl text-blue-600"><BarChart3 size={24} /></div>
                  彙整中心
                </h2>
                <div className="flex items-center gap-4">
                  {isCloudActive && lastSync && <span className="text-[9px] font-black text-green-500 flex items-center gap-1"><RefreshCw size={10} className="animate-spin" /> 已更新: {lastSync.toLocaleTimeString()}</span>}
                  <button onClick={() => setStep(Step.Selection)} className="text-sm font-black text-gray-400 hover:text-blue-600 uppercase">返回</button>
                </div>
              </div>

              <div className="mb-10 bg-indigo-50/50 p-8 rounded-[2.5rem] border border-indigo-100">
                <p className="text-xs text-indigo-700 font-black mb-4 flex items-center gap-2"><PackagePlus size={18} /> 手動匯入同事代碼</p>
                <div className="flex gap-3">
                  <input placeholder="貼上同事複製的代碼..." className="flex-1 bg-white border border-indigo-200 rounded-2xl px-5 py-4 text-xs outline-none focus:ring-2 focus:ring-indigo-400 font-black" value={importText} onChange={(e) => setImportText(e.target.value)} />
                  <button onClick={handleImportOrder} className="bg-indigo-600 text-white px-8 rounded-2xl font-black text-sm hover:bg-indigo-700 shadow-lg active:scale-95 transition-all">匯入</button>
                </div>
              </div>

              {history.length > 0 ? (
                <div className="space-y-8">
                  <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm p-8">
                    <h3 className="text-xs font-black text-gray-400 uppercase mb-6 border-b pb-4">餐點統計結果 ({history.length} 人點餐)</h3>
                    <div className="space-y-4">
                      {(Object.entries(aggregateStats) as [string, { qty: number, total: number, details: string[] }][]).map(([key, stat]) => (
                        <div key={key} className="flex justify-between items-center bg-gray-50/50 p-4 rounded-2xl border border-gray-50 group hover:border-blue-100 transition-colors">
                          <div className="flex-1">
                            <p className="font-black text-gray-800 text-base">{key}</p>
                            <p className="text-[10px] text-gray-400 font-black mt-1">{stat.details.join(' · ')}</p>
                          </div>
                          <div className="text-right ml-4"><p className="text-2xl font-black text-blue-600 font-mono">x{stat.qty}</p></div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm p-8">
                    <h3 className="text-xs font-black text-gray-400 uppercase mb-6 border-b pb-4 flex items-center gap-2"><ListOrdered size={16} /> 個人點單詳情</h3>
                    <div className="space-y-6">
                      {history.map((order, idx) => (
                        <div key={idx} className="p-5 bg-gray-50/30 rounded-3xl border border-gray-100 animate-in slide-in-from-left-2 duration-300">
                          <div className="flex justify-between items-start mb-3">
                            <p className="font-black text-gray-800">{order.empName} <span className="font-normal text-xs text-gray-400">{order.empId && `(${order.empId})`}</span></p>
                            <p className="font-mono font-black text-blue-600">${order.total}</p>
                          </div>
                          <div className="space-y-1 mb-3">
                            {order.items.map((item, iidx) => (
                              <p key={iidx} className="text-[11px] text-gray-600 font-bold">• {item.name} {item.hasAddon ? `+${item.addonName}` : ''} x{item.quantity} {item.note && <span className="text-red-400 italic ml-1">({item.note})</span>}</p>
                            ))}
                          </div>
                          {order.orderNote && <p className="text-[10px] font-bold text-blue-800 bg-blue-50 px-3 py-1.5 rounded-xl mt-1 leading-relaxed">全單備註: {order.orderNote}</p>}
                        </div>
                      ))}
                    </div>
                  </div>

                  <button onClick={() => {
                     const headers = ['時間', '姓名', '工號', '電話', '餐點明細 (品項+加料(備註)x數量)', '全單總備註', '總計金額'];
                     const rows = history.map(h => [
                       h.timestamp, h.empName, h.empId, h.phone, 
                       `"${h.items.map(i => `${i.name}${i.hasAddon?`+${i.addonName}`:''}${i.note?`(${i.note})`:''}x${i.quantity}`).join(';')}"`, 
                       `"${h.orderNote || ''}"`, h.total
                     ]);
                     const csvContent = "\ufeff" + [headers, ...rows].map(r => r.join(',')).join('\n');
                     const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                     const link = document.createElement('a'); 
                     link.href = URL.createObjectURL(blob); 
                     link.download = `QuickBite訂單報表_${new Date().toISOString().split('T')[0]}.csv`; 
                     link.click();
                  }} className="w-full bg-green-50 text-green-700 py-6 rounded-[2rem] font-black border border-green-100 flex items-center justify-center gap-3 hover:bg-green-100 transition-all shadow-lg active:scale-95"><Download size={24} /> 匯出完整統計報表 (CSV)</button>
                </div>
              ) : (
                <div className="text-center py-24 text-gray-300 font-black border-2 border-dashed border-gray-50 rounded-[2.5rem] flex flex-col items-center gap-4">
                   <Cloud className="opacity-10" size={48} />
                   <span>{isCloudActive ? `雲端房間 ${roomId} 等待點單中...` : '目前無訂單資料'}</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-center mb-10">
           <button onClick={() => setStep(Step.History)} className="group px-6 py-3 bg-white/50 backdrop-blur-sm rounded-full border border-white text-[11px] font-black uppercase tracking-widest text-gray-400 hover:text-blue-600 hover:border-blue-100 transition-all flex items-center gap-3 active:scale-95">
             <BarChart3 size={14} /> 主辦人彙整模式
           </button>
        </div>
      </div>
    </div>
  );
};

export default App;
