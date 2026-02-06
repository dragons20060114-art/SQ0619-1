
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
  ChevronLeft,
  Share2,
  PackagePlus,
  BarChart3,
  Copy,
  CheckCircle2,
  QrCode,
  Zap,
  ListOrdered,
  Send,
  Undo2,
  ShoppingBag,
  FileSpreadsheet,
  Link,
  CloudUpload,
  ExternalLink,
  Info,
  Code
} from 'lucide-react';
import { OrderItem, UserInfo, OrderHistoryEntry, Step } from './types';
import { analyzeMenuContent } from './services/geminiService';
import { InputField, Toast, StepIndicator } from './components/UI';

const generateId = () => Math.random().toString(36).substring(2, 11) + Date.now().toString(36);

const GAS_SCRIPT_TEMPLATE = `function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return ContentService.createTextOutput("Fail: Invalid JSON").setMimeType(ContentService.MimeType.TEXT);
  }
  
  var itemSummary = data.items.map(function(i){ 
    return i.name + "x" + i.quantity; 
  }).join("; ");

  var addonSummary = data.items.map(function(i){ 
    return (i.hasAddon && i.addonName) ? i.addonName : ""; 
  }).filter(function(t){ return t !== ""; }).join("; ");

  var itemNoteSummary = data.items.map(function(i){ 
    return i.note || ""; 
  }).filter(function(t){ return t !== ""; }).join("; ");

  sheet.appendRow([
    new Date(),
    data.empName,
    data.empId || "",
    data.phone || "",
    itemSummary,
    addonSummary,
    itemNoteSummary,
    data.orderNote || "",
    data.total
  ]);
  
  return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
}`;

const shrink = {
  async compress(data: any, extra?: any): Promise<string> {
    const minified = Array.isArray(data) 
      ? { m: data.map(i => ({ n: i.name, p: i.price, nt: i.note, h: i.hasAddon, an: i.addonName, ap: i.addonPrice })), x: extra }
      : { 
          id: data.empId, 
          nm: data.empName, 
          ph: data.phone, 
          on: data.orderNote, 
          t: data.total, 
          ts: data.timestamp, 
          i: data.items.map((it: any) => ({ 
            n: it.n, p: it.price, nt: it.note, h: it.hasAddon, an: it.addonName, ap: it.addonPrice, q: it.quantity 
          })) 
        };
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
      if (parsed.m) {
        return {
          menu: parsed.m.map((i: any) => ({ 
            name: i.n, price: i.price || i.p, note: i.note || i.nt, hasAddon: i.hasAddon || i.h, addonName: i.addonName || i.an, addonPrice: i.addonPrice || i.ap 
          })),
          extra: parsed.x
        };
      } else {
        return { 
          empId: parsed.id, 
          empName: parsed.nm, 
          phone: parsed.ph, 
          orderNote: parsed.on, 
          total: parsed.t, 
          timestamp: parsed.ts, 
          items: parsed.i.map((it: any) => ({ 
            name: it.n, 
            price: it.p, 
            note: it.nt, 
            hasAddon: it.h, 
            addonName: it.an, 
            addonPrice: it.ap, 
            quantity: it.q 
          })) 
        };
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
  const [gasUrl, setGasUrl] = useState('');
  const [activeGasUrl, setActiveGasUrl] = useState<string | null>(null);
  const [manualCodeInput, setManualCodeInput] = useState('');
  const [showCodeInput, setShowCodeInput] = useState(false);
  const [showGasConfig, setShowGasConfig] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [userInfo, setUserInfo] = useState<UserInfo>(() => {
    const saved = localStorage.getItem('quickbite_user');
    return saved ? JSON.parse(saved) : { empId: '', empName: '', phone: '', orderNote: '' };
  });
  
  const [items, setItems] = useState<OrderItem[]>([{ id: generateId(), name: '', price: '', note: '', quantity: 0, hasAddon: false, addonName: '', addonPrice: '' }]);
  const [history, setHistory] = useState<OrderHistoryEntry[]>([]);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const encoded = params.get('m');
    if (encoded) {
      handleImport(encoded, true);
    }
  }, []);

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
          } else { showToast('辨識結果為空', 'error'); }
        } catch (err) { showToast('AI 辨識失敗', 'error'); }
        finally { setIsAiAnalyzing(false); }
      };
      reader.readAsDataURL(file);
    } catch (error) { showToast('讀取失敗', 'error'); setIsAiAnalyzing(false); }
  };

  const generateMenuTemplateCode = async () => {
    const menuTemplate = items.filter(i => i.name).map(i => ({
      name: i.name, price: i.price, note: i.note, hasAddon: i.hasAddon, addonName: i.addonName, addonPrice: i.addonPrice
    }));
    if (menuTemplate.length === 0) { showToast('請先建立菜單內容', 'error'); return; }
    setIsLoading(true);
    try {
      const code = await shrink.compress(menuTemplate, { gas: gasUrl });
      const shareUrl = `${window.location.origin}${window.location.pathname}?m=${encodeURIComponent(code)}`;
      navigator.clipboard.writeText(shareUrl);
      showToast('點餐專屬連結已複製！');
    } catch (e) { showToast('生成失敗', 'error'); }
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
      const itemBasePrice = parseFloat(item.price) || 0;
      const itemAddonPrice = item.hasAddon ? (parseFloat(item.addonPrice) || 0) : 0;
      return sum + ((itemBasePrice + itemAddonPrice) * item.quantity);
    }, 0);
  }, [items]);

  const aggregateStats = useMemo(() => {
    const stats: Record<string, { qty: number, total: number, details: string[] }> = {};
    history.forEach(order => {
      order.items.forEach(item => {
        const key = item.name;
        if (!key) return;
        if (!stats[key]) stats[key] = { qty: 0, total: 0, details: [] };
        stats[key].qty += item.quantity;
        const unitPrice = (parseFloat(item.price) || 0) + (item.hasAddon ? (parseFloat(item.addonPrice) || 0) : 0);
        stats[key].total += (unitPrice * item.quantity);
        
        const noteTag = item.note ? item.note : '';
        const addonTag = item.hasAddon && item.addonName ? `+${item.addonName}` : '';
        const detail = [noteTag, addonTag].filter(t => t).join(' / ');
        if (detail && !stats[key].details.includes(detail)) stats[key].details.push(detail);
      });
    });
    return stats;
  }, [history]);

  const handleSubmit = async () => {
    localStorage.setItem('quickbite_user', JSON.stringify(userInfo));
    const activeItems = items.filter(item => item.name && item.quantity > 0);
    const orderData: OrderHistoryEntry = {
      ...userInfo, items: activeItems.map(i => ({...i})), total: totalPrice, timestamp: new Date().toISOString()
    };
    setHistory(prev => [orderData, ...prev]);
    setStep(Step.Success);
  };

  const handleGasSubmit = async () => {
    if (!activeGasUrl) return;
    setIsLoading(true);
    const latestOrder = history[0];
    try {
      await fetch(activeGasUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(latestOrder)
      });
      showToast('點單已成功傳送至試算表！');
    } catch (e) {
      showToast('傳送發生錯誤，請通知主辦人', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleImport = async (text: string, isMenu: boolean) => {
    if (!text.trim()) return;
    try {
      const cleanText = text.includes('m=') ? new URLSearchParams(text.split('?')[1]).get('m') || text : text;
      const decoded = await shrink.decompress(cleanText);
      if (isMenu || decoded.menu) {
        const menuData = decoded.menu || decoded;
        setItems(menuData.map((i: any) => ({ ...i, id: generateId(), quantity: 0 })));
        if (decoded.extra?.gas) {
          setActiveGasUrl(decoded.extra.gas);
        }
        showToast('菜單載入成功！');
        setShowCodeInput(false);
      } else {
        setHistory(prev => [decoded, ...prev]);
        setImportText('');
        showToast('點單匯入成功！');
      }
    } catch (e) { showToast('解析失敗', 'error'); }
  };

  const getReportData = (delimiter: string = ',') => {
    const headers = ['時間', '姓名', '工號', '電話', '餐點明細', '加料詳情', '品項備註', '全單總備註', '總額'];
    const rows = history.map(h => [
       new Date(h.timestamp).toLocaleString(), 
       h.empName, 
       h.empId, 
       h.phone, 
       h.items.map(i => `${i.name}x${i.quantity}`).join('; '),
       h.items.map(i => i.hasAddon && i.addonName ? i.addonName : '').filter(t => t).join('; '),
       h.items.map(i => i.note || '').filter(t => t).join('; '),
       h.orderNote || '', 
       h.total
    ]);
    return [headers, ...rows].map(r => r.map(cell => `"${cell}"`).join(delimiter)).join('\n');
  };

  return (
    <div className="min-h-screen bg-[#FFFBEB] text-[#1D1D1F] p-4 md:p-8 flex flex-col items-center">
      {(isAiAnalyzing || isLoading) && (
        <div className="fixed inset-0 bg-amber-50/70 backdrop-blur-md z-[100] flex flex-col items-center justify-center">
          <div className="w-16 h-16 border-4 border-amber-600 border-t-amber-900 rounded-full animate-spin"></div>
          <p className="mt-4 font-black text-black animate-pulse tracking-widest text-[10px] uppercase">處理中...</p>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} />}

      <div className="w-full max-w-2xl">
        <header className="mb-8 text-center animate-in slide-in-from-top-4">
          <h1 className="text-4xl font-black tracking-tight mb-2 bg-clip-text text-transparent bg-gradient-to-r from-amber-600 to-orange-700">QuickBite</h1>
          <p className="text-black/60 font-black text-[10px] tracking-[0.2em] uppercase">Office Lunch Ordering Mastery</p>
          {activeGasUrl && (
            <div className="mt-4 inline-flex items-center gap-2 bg-black text-white px-4 py-1.5 rounded-full shadow-lg animate-in fade-in">
              <CloudUpload size={14} className="text-amber-400 animate-bounce" />
              <span className="text-[10px] font-black uppercase tracking-wider">已連結 Google 試算表</span>
            </div>
          )}
        </header>

        <div className="bg-white rounded-[2.5rem] shadow-2xl shadow-amber-900/10 border border-amber-100 p-6 md:p-10 mb-8 relative overflow-hidden">
          {step <= 3 && <StepIndicator currentStep={step} />}

          {step === Step.Selection && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex flex-col gap-4 mb-8">
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => fileInputRef.current?.click()} className="flex flex-col items-center justify-center gap-2 p-4 bg-amber-400 text-black rounded-[2rem] hover:bg-amber-500 transition-all shadow-lg active:scale-95">
                    <Camera size={24} />
                    <span className="text-sm font-black uppercase">拍照辨識菜單</span>
                  </button>
                  <button onClick={() => setShowCodeInput(!showCodeInput)} className={`flex flex-col items-center justify-center gap-2 p-4 rounded-[2rem] border-2 transition-all active:scale-95 ${showCodeInput ? 'bg-orange-100 border-orange-500 text-black' : 'bg-white border-amber-200 text-black hover:border-amber-400'}`}>
                    <QrCode size={24} className={showCodeInput ? 'text-black' : 'text-amber-500'} />
                    <span className="text-sm font-black uppercase">匯入點餐連結</span>
                  </button>
                </div>
                {showCodeInput && (
                  <div className="p-4 bg-orange-100/50 rounded-3xl border border-orange-200 animate-in slide-in-from-top-4">
                    <div className="flex gap-2">
                      <input placeholder="貼上點餐連結或 MENU 代碼..." className="flex-1 bg-white border border-orange-300 rounded-xl px-4 py-3 text-xs outline-none focus:ring-2 focus:ring-orange-500 font-black text-black" value={manualCodeInput} onChange={(e) => setManualCodeInput(e.target.value)} />
                      <button onClick={() => handleImport(manualCodeInput, true)} className="bg-orange-600 text-black px-6 rounded-xl font-black text-sm hover:bg-orange-700 transition-colors">載入</button>
                    </div>
                  </div>
                )}
              </div>

              <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileUpload} />

              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-black flex items-center gap-3 text-black">
                  <div className="bg-amber-100 p-2 rounded-xl text-amber-600"><ShoppingCart size={20} /></div>
                  挑選餐點
                </h2>
                <button onClick={() => setItems([...items, { id: generateId(), name: '', price: '', note: '', quantity: 0, hasAddon: false, addonName: '', addonPrice: '' }])} className="text-[10px] bg-amber-100 text-black px-4 py-2 rounded-full font-black hover:bg-amber-200 flex items-center gap-1 uppercase transition-colors">
                  <Plus size={14} /> 手動增加
                </button>
              </div>

              <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar pb-4">
                {items.length === 0 || (items.length === 1 && !items[0].name) ? (
                  <div className="text-center py-16 border-2 border-dashed border-amber-200 rounded-[2.5rem] bg-amber-50/30">
                    <ShoppingBag size={40} className="mx-auto text-amber-400 mb-4" />
                    <p className="text-sm text-black font-black leading-relaxed opacity-60">拍照辨識菜單或手動新增<br/>主辦人可設定 GAS 自動回填試算表</p>
                  </div>
                ) : (
                  items.map((item) => (
                    <div key={item.id} className="p-5 bg-white rounded-[2rem] border border-amber-200 shadow-sm transition-all hover:shadow-md hover:border-amber-400 group relative">
                      <div className="grid grid-cols-12 gap-3 items-center mb-4">
                        <div className="col-span-12 md:col-span-6">
                          <input placeholder="品項名稱" className="w-full bg-amber-50/30 border-none rounded-xl px-4 py-3 text-sm font-black text-black focus:ring-2 focus:ring-amber-300" value={item.name} onChange={(e) => updateItem(item.id, 'name', e.target.value)} />
                        </div>
                        <div className="col-span-6 md:col-span-3 flex items-center bg-amber-100/50 rounded-xl p-1 border border-amber-200">
                          <button onClick={() => updateQuantity(item.id, -1)} className="w-8 h-8 flex items-center justify-center text-black hover:bg-white rounded-lg transition-colors"><Minus size={16} /></button>
                          <span className={`flex-1 text-center font-black ${item.quantity > 0 ? 'text-black' : 'text-gray-400'}`}>{item.quantity}</span>
                          <button onClick={() => updateQuantity(item.id, 1)} className="w-8 h-8 flex items-center justify-center text-black hover:bg-white rounded-lg transition-colors"><Plus size={16} /></button>
                        </div>
                        <div className="col-span-6 md:col-span-3 relative flex items-center">
                          <span className="absolute left-3 text-amber-600 text-xs font-black">$</span>
                          <input type="number" placeholder="價格" className="w-full bg-amber-50/30 border-none rounded-xl pl-6 pr-4 py-3 text-sm text-right font-mono font-black text-black focus:ring-2 focus:ring-amber-300" value={item.price} onChange={(e) => updateItem(item.id, 'price', e.target.value)} />
                        </div>
                      </div>
                      
                      {item.hasAddon && (
                        <div className="mb-4 p-4 bg-orange-50 border border-orange-200 rounded-2xl animate-in slide-in-from-top-2">
                           <div className="flex items-center gap-3">
                              <div className="flex-1">
                                <p className="text-[9px] text-black font-black uppercase mb-1 ml-1">加料名稱</p>
                                <input placeholder="珍珠、加蛋、起司..." className="w-full bg-white border border-orange-300 rounded-xl px-4 py-2.5 text-xs font-black text-black focus:ring-2 focus:ring-orange-400 shadow-sm" value={item.addonName} onChange={(e) => updateItem(item.id, 'addonName', e.target.value)} />
                              </div>
                              <div className="w-24">
                                <p className="text-[9px] text-black font-black uppercase mb-1 ml-1">加價</p>
                                <div className="relative flex items-center">
                                  <span className="absolute left-2 text-orange-600 text-[10px] font-black">$</span>
                                  <input type="number" placeholder="0" className="w-full bg-white border border-orange-300 rounded-xl pl-5 pr-3 py-2.5 text-xs text-right font-mono font-black text-black focus:ring-2 focus:ring-orange-400 shadow-sm" value={item.addonPrice} onChange={(e) => updateItem(item.id, 'addonPrice', e.target.value)} />
                                </div>
                              </div>
                           </div>
                        </div>
                      )}

                      <div className="flex gap-2">
                        <button onClick={() => updateItem(item.id, 'hasAddon', !item.hasAddon)} className={`text-[10px] px-4 py-2.5 rounded-full font-black transition-all flex items-center gap-1.5 ${item.hasAddon ? 'bg-orange-600 text-white shadow-md' : 'bg-amber-100 text-black hover:bg-amber-200'}`}>
                          {item.hasAddon ? <Minus size={12}/> : <Plus size={12}/>}
                          {item.hasAddon ? '移除加點' : '加點 / 加料'}
                        </button>
                        <div className="flex-1 flex items-center gap-2 bg-white px-3 py-2 rounded-xl border border-dashed border-amber-300">
                          <MessageSquare size={12} className="text-amber-500" />
                          <input placeholder="備註 (去冰微糖、大辣)" className="w-full bg-transparent border-none p-0 text-[11px] text-black font-black placeholder:text-gray-300 outline-none" value={item.note} onChange={(e) => updateItem(item.id, 'note', e.target.value)} />
                        </div>
                        <button onClick={() => setItems(items.filter(i => i.id !== item.id))} className="text-gray-300 hover:text-red-600 transition-colors group-hover:opacity-100 opacity-0"><Trash2 size={16} /></button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="mt-8 pt-8 border-t border-amber-100">
                <div className="mb-6 space-y-4">
                  <div className="flex justify-between items-center px-1">
                    <p className="text-[10px] text-black font-black uppercase tracking-widest opacity-60">主辦人自動化工具</p>
                    <button onClick={() => setShowGasConfig(!showGasConfig)} className="text-[10px] font-black text-amber-700 flex items-center gap-1 uppercase">
                      {showGasConfig ? '收起設定' : '設定 GAS 回填'}
                    </button>
                  </div>
                  
                  {showGasConfig && (
                    <div className="p-6 bg-amber-50/50 rounded-[2rem] border border-amber-200 animate-in slide-in-from-top-2 space-y-4 shadow-inner">
                      <div className="bg-white p-4 rounded-2xl shadow-sm">
                        <p className="text-[11px] font-black text-black mb-3 flex items-center gap-2 uppercase">
                          <Code size={16} className="text-amber-600" /> 第一步：複製腳本
                        </p>
                        <button onClick={() => { navigator.clipboard.writeText(GAS_SCRIPT_TEMPLATE); showToast('腳本已複製！'); }} className="w-full py-3 bg-amber-400 text-black rounded-xl text-xs font-black flex items-center justify-center gap-2 hover:bg-amber-500 active:scale-95 transition-all">
                          一鍵複製 GAS 腳本代碼
                        </button>
                      </div>

                      <div className="bg-white p-4 rounded-2xl shadow-sm">
                        <p className="text-[11px] font-black text-black mb-3 flex items-center gap-2 uppercase">
                          <Link size={16} className="text-amber-600" /> 第二步：貼上網頁應用程式 URL
                        </p>
                        <input placeholder="https://script.google.com/macros/s/..." className="w-full bg-amber-50/50 border border-amber-200 rounded-xl px-4 py-3 text-xs font-black focus:ring-2 focus:ring-amber-500 outline-none text-black" value={gasUrl} onChange={(e) => setGasUrl(e.target.value)} />
                      </div>

                      <div className="p-4 bg-white/80 rounded-2xl border border-dashed border-amber-400">
                         <p className="text-[10px] font-black text-black flex items-center gap-2 mb-2"><Info size={14}/> 部署提醒：</p>
                         <ul className="text-[10px] text-gray-700 font-bold space-y-1 ml-1 list-disc list-inside">
                           <li>在編輯器點擊「部署」→「新增部署」</li>
                           <li>類型選「網頁應用程式」，執行身分選「我」</li>
                           <li>存取權選「所有人」(Anyone)</li>
                           <li>部署完成後複製連結貼在上方輸入框</li>
                         </ul>
                      </div>
                    </div>
                  )}

                  <button onClick={generateMenuTemplateCode} className="w-full flex items-center justify-center gap-3 px-6 py-5 bg-amber-400 text-black rounded-[1.5rem] font-black shadow-xl active:scale-95 transition-all hover:bg-amber-500">
                    <Share2 size={20} />
                    <span className="uppercase tracking-wide">複製專屬點餐連結</span>
                  </button>
                </div>
                
                <div className="flex flex-col sm:flex-row justify-between items-center gap-6 bg-white border border-amber-100 p-6 rounded-[2rem] shadow-sm">
                  <div className="text-left w-full sm:w-auto">
                    <p className="text-[10px] text-gray-500 font-black mb-1 uppercase tracking-tighter">My Subtotal 小計</p>
                    <p className="text-3xl font-black text-black font-mono">${totalPrice}</p>
                  </div>
                  <button onClick={() => items.some(i => i.quantity > 0) ? setStep(Step.UserInfo) : showToast('請先選擇餐點', 'error')} className="w-full sm:w-auto px-12 py-5 bg-black text-white rounded-[1.5rem] font-black shadow-2xl flex items-center justify-center gap-2 hover:translate-x-1 active:scale-95 transition-all">
                    下一步 <ChevronRight size={20} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {step === Step.UserInfo && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <h2 className="text-2xl font-black mb-8 flex items-center gap-3 text-black">
                <div className="bg-amber-100 p-2 rounded-xl text-amber-600"><User size={24} /></div>
                個人資訊
              </h2>
              <InputField icon={IdCard} label="員工編號 (選填)" placeholder="例如: TW12345" value={userInfo.empId} onChange={(e) => setUserInfo({...userInfo, empId: e.target.value})} />
              <InputField icon={User} label="姓名 (必填)" placeholder="例如: 王小明" value={userInfo.empName} onChange={(e) => setUserInfo({...userInfo, empName: e.target.value})} />
              <InputField icon={Phone} label="聯絡電話" placeholder="例如: 0912345678" type="tel" value={userInfo.phone} onChange={(e) => setUserInfo({...userInfo, phone: e.target.value})} />
              <div className="mt-8 bg-amber-50 border border-amber-200 p-6 rounded-[2rem]">
                <div className="flex items-center gap-3 mb-3 text-black font-black text-xs uppercase tracking-widest"><StickyNote size={18} /> 全單總備註</div>
                <textarea placeholder="例如：加辣、不要香菜、或者給同事的訊息..." className="w-full bg-transparent border-none p-0 focus:ring-0 text-sm h-20 outline-none resize-none font-bold text-black placeholder:text-gray-400" value={userInfo.orderNote} onChange={(e) => setUserInfo({...userInfo, orderNote: e.target.value})} />
              </div>
              <div className="flex gap-4 mt-10">
                <button onClick={() => setStep(Step.Selection)} className="flex-1 bg-amber-100 text-black py-5 rounded-2xl font-black hover:bg-amber-200 transition-all flex items-center justify-center gap-2"><ChevronLeft size={20} /> 上一步</button>
                <button onClick={() => userInfo.empName ? setStep(Step.Review) : showToast('請填寫姓名', 'error')} className="flex-[2] bg-amber-400 text-black py-5 rounded-2xl font-black shadow-xl flex items-center justify-center gap-2 hover:bg-amber-500 active:scale-95 transition-all uppercase tracking-widest">核對明細 <ChevronRight size={20} /></button>
              </div>
            </div>
          )}

          {step === Step.Review && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <h2 className="text-2xl font-black mb-6 flex items-center gap-3 text-black">
                <div className="bg-amber-100 p-2 rounded-xl text-amber-600"><ClipboardCheck size={24} /></div>
                最後確認
              </h2>
              <div className="bg-amber-50 rounded-[2.5rem] p-8 mb-8 border border-amber-200 shadow-inner">
                <div className="flex justify-between items-start mb-8 pb-6 border-b border-amber-200">
                  <div>
                    <p className="text-[10px] text-gray-500 font-black uppercase mb-1">訂購人</p>
                    <p className="font-black text-xl text-black">{userInfo.empName} <span className="text-gray-400 font-normal text-sm">{userInfo.empId && `(${userInfo.empId})`}</span></p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-gray-500 font-black uppercase mb-1">應付總計</p>
                    <p className="font-black text-2xl text-black font-mono">${totalPrice}</p>
                  </div>
                </div>
                <div className="space-y-5">
                  {items.filter(i => i.quantity > 0).map((item, idx) => (
                    <div key={idx} className="flex justify-between items-center text-sm">
                      <div className="flex flex-col">
                        <span className="font-black text-black text-base">{item.name}</span>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {item.hasAddon && item.addonName && <span className="text-[10px] bg-black text-white px-2 py-0.5 rounded-full font-black tracking-tight">加料: {item.addonName} (+${item.addonPrice || 0})</span>}
                          {item.note && <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-black italic">{item.note}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="font-black text-white px-3 py-1 bg-black rounded-lg text-base">x{item.quantity}</span>
                        <span className="font-mono text-black w-16 text-right font-black">${((parseFloat(item.price) || 0) + (item.hasAddon ? (parseFloat(item.addonPrice) || 0) : 0)) * item.quantity}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-3">
                <button onClick={handleSubmit} className="w-full bg-amber-400 text-black py-6 rounded-3xl font-black text-xl shadow-2xl flex items-center justify-center gap-3 hover:bg-amber-500 active:scale-95 transition-all uppercase tracking-widest">
                  <Send size={24} /> 確認送出點單
                </button>
                <button onClick={() => setStep(Step.UserInfo)} className="w-full bg-amber-100 text-black py-4 rounded-2xl font-black text-sm flex items-center justify-center gap-2 hover:bg-amber-200 transition-all uppercase tracking-widest">
                  <Undo2 size={18} /> 返回修改資訊
                </button>
              </div>
            </div>
          )}

          {step === Step.Success && (
            <div className="text-center py-10 animate-in zoom-in-95">
              <div className="w-24 h-24 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-8 shadow-inner"><CheckCircle2 size={48} /></div>
              <h2 className="text-3xl font-black mb-4 text-black">點單完成！</h2>
              
              <div className="max-w-sm mx-auto space-y-4">
                {activeGasUrl ? (
                  <>
                    <p className="text-black font-black mb-6 text-sm leading-relaxed">主辦人已開啟自動回填，請點擊按鈕同步至試算表。</p>
                    <button onClick={handleGasSubmit} className="bg-amber-400 text-black py-6 px-10 rounded-[2rem] font-black shadow-2xl flex items-center justify-center gap-3 hover:bg-amber-500 active:scale-95 transition-all w-full text-xl group uppercase tracking-widest">
                      <CloudUpload size={28} className="group-hover:animate-bounce" /> 回傳至試算表
                    </button>
                    <div className="py-2 flex items-center gap-3">
                      <div className="flex-1 h-px bg-amber-200"></div>
                      <span className="text-[10px] text-amber-500 font-black uppercase tracking-widest">備用方案</span>
                      <div className="flex-1 h-px bg-amber-200"></div>
                    </div>
                  </>
                ) : (
                  <p className="text-gray-600 mb-10 text-sm font-black leading-relaxed">請複製點單代碼，發給主辦同事彙整。</p>
                )}
                
                <button onClick={async () => { const code = await shrink.compress(history[0]); navigator.clipboard.writeText(code); showToast('代碼已複製！'); }} className={`py-5 px-10 rounded-[2rem] font-black shadow-xl flex items-center justify-center gap-3 active:scale-95 transition-all w-full uppercase tracking-widest ${activeGasUrl ? 'bg-white border-2 border-black text-black hover:bg-black hover:text-white' : 'bg-amber-400 text-black hover:bg-amber-500'}`}>
                  <Copy size={20} /> 複製點單代碼
                </button>
                <button onClick={() => setStep(Step.Selection)} className="block pt-6 mx-auto text-black text-xs font-black hover:underline uppercase tracking-widest transition-colors">再點一份</button>
              </div>
            </div>
          )}

          {step === Step.History && (
            <div className="animate-in fade-in duration-500">
              <div className="flex justify-between items-center mb-8">
                <h2 className="text-2xl font-black flex items-center gap-3 text-black">
                  <div className="bg-amber-100 p-2 rounded-xl text-amber-600"><BarChart3 size={24} /></div>
                  彙整中心
                </h2>
                <button onClick={() => setStep(Step.Selection)} className="text-sm font-black text-gray-500 hover:text-black uppercase transition-colors tracking-widest">返回</button>
              </div>

              <div className="mb-10 bg-orange-50 p-8 rounded-[2.5rem] border border-orange-200 shadow-inner">
                <p className="text-xs text-black font-black mb-4 flex items-center gap-2 tracking-widest uppercase opacity-70"><PackagePlus size={18} /> 手動匯入代碼</p>
                <div className="flex gap-3">
                  <input placeholder="貼上同事發給您的壓縮代碼..." className="flex-1 bg-white border border-orange-300 rounded-2xl px-5 py-4 text-xs outline-none focus:ring-2 focus:ring-orange-500 font-black text-black shadow-sm" value={importText} onChange={(e) => setImportText(e.target.value)} />
                  <button onClick={() => handleImport(importText, false)} className="bg-orange-600 text-black px-8 rounded-2xl font-black text-sm hover:bg-orange-700 shadow-lg active:scale-95 transition-all">匯入</button>
                </div>
              </div>

              {history.length > 0 ? (
                <div className="space-y-8">
                  <div className="bg-white rounded-[2.5rem] border border-amber-200 shadow-sm p-8">
                    <h3 className="text-xs font-black text-gray-500 uppercase mb-6 border-b border-amber-100 pb-4 tracking-tighter">餐點統計 ({history.length} 人)</h3>
                    <div className="space-y-4">
                      {(Object.entries(aggregateStats) as [string, { qty: number, total: number, details: string[] }][]).map(([key, stat]) => (
                        <div key={key} className="flex justify-between items-center bg-amber-50/30 p-4 rounded-2xl border border-amber-100 group hover:border-amber-400 transition-colors">
                          <div className="flex-1">
                            <p className="font-black text-black text-base">{key}</p>
                            <p className="text-[10px] text-gray-600 font-black mt-1 leading-tight uppercase">{stat.details.join(' · ')}</p>
                          </div>
                          <div className="text-right ml-4"><p className="text-2xl font-black text-black font-mono">x{stat.qty}</p></div>
                        </div>
                      ))}
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <button onClick={() => {
                       const content = getReportData(',');
                       const blob = new Blob(["\ufeff" + content], { type: 'text/csv;charset=utf-8;' });
                       const link = document.createElement('a'); 
                       link.href = URL.createObjectURL(blob); 
                       link.download = `QuickBite_${new Date().toISOString().split('T')[0]}.csv`; 
                       link.click();
                       showToast('CSV 已下載');
                    }} className="w-full bg-green-100 text-black py-6 rounded-[2rem] font-black border border-green-200 flex items-center justify-center gap-3 hover:bg-green-200 active:scale-95 shadow-sm transition-all uppercase tracking-widest"><Download size={24} /> 匯出 CSV</button>
                    
                    <button onClick={() => {
                       const content = getReportData('\t');
                       navigator.clipboard.writeText(content);
                       showToast('已複製！請至試算表貼上');
                    }} className="w-full bg-amber-100 text-black py-6 rounded-[2rem] font-black border border-amber-200 flex items-center justify-center gap-3 hover:bg-amber-200 active:scale-95 shadow-sm transition-all uppercase tracking-widest"><FileSpreadsheet size={24} /> 複製到試算表</button>
                  </div>
                </div>
              ) : (
                <div className="text-center py-24 text-gray-400 font-black border-2 border-dashed border-amber-200 rounded-[2.5rem] flex flex-col items-center gap-4 bg-white/50">
                   <PackagePlus className="opacity-20 text-black" size={48} />
                   <p className="leading-relaxed uppercase tracking-widest text-[10px]">目前尚未有任何點單資料</p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-center mb-10 gap-4">
           <button onClick={() => setStep(Step.History)} className="group px-8 py-4 bg-white rounded-full border border-amber-200 text-[12px] font-black uppercase tracking-widest text-black hover:bg-amber-100 transition-all flex items-center gap-3 active:scale-95 shadow-md">
             <BarChart3 size={16} className="text-amber-500" /> 開啟統計彙整
           </button>
        </div>
      </div>
    </div>
  );
};

export default App;
