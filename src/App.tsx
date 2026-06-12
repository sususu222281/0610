/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  updateProfile,
  reload,
  User
} from "firebase/auth";
import { 
  collection, 
  addDoc, 
  query, 
  orderBy, 
  limit, 
  onSnapshot, 
  serverTimestamp,
  doc,
  where,
  deleteDoc,
  getDocs
} from "firebase/firestore";
import { db, auth, googleProvider } from "./firebase";
import { 
  LogIn, 
  UserPlus, 
  Mail, 
  Lock, 
  User as UserIcon, 
  RefreshCw, 
  ShieldCheck, 
  AlertTriangle, 
  Send, 
  LogOut,
  CheckCircle,
  Eye,
  EyeOff,
  Sparkles,
  Heart,
  Cloud,
  MessageSquare,
  FileText,
  Trash2,
  HelpCircle,
  Clock,
  Plus,
  Search,
  X
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// --- Tab & Authentication Modes ---
type ActiveModule = "chat" | "test" | "account";
type AuthMode = "login" | "register" | "forgot";

interface ChatRoom {
  id: string;
  name: string;
  createdAt: number;
}

// --- Firestore Operation types to conform with Firebase Integration Skill ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

// Global robust error parser that logs detailed intermediate JSON
function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error("Firestore Error detail: ", JSON.stringify(errInfo));
  return errInfo;
}

// --- HELPER: WEB AUDIO API WOODEN FISH KNOCK SOUND ---
const playWoodenFishSound = () => {
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    // Triangle oscillator mimics the hollow wooden block timbre with soft odd overtones
    osc.type = "triangle";
    
    // Fast frequency pitch sweep mimics the resonance drop when striking wood
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(560, now);
    osc.frequency.exponentialRampToValueAtTime(140, now + 0.09);
    
    // Precise envelope: instantaneous peak followed by steep, clean decay
    gainNode.gain.setValueAtTime(0.01, now);
    gainNode.gain.linearRampToValueAtTime(0.55, now + 0.003); // Attack
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.12); // Decay
    
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    osc.start(now);
    osc.stop(now + 0.15);
  } catch (err) {
    console.warn("Failed to play wooden fish sound on user interaction:", err);
  }
};

export default function App() {
  // Current logged in user context
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  
  // Navigation tabs (多模塊)
  const [activeTab, setActiveTab] = useState<ActiveModule>("chat");
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  
  // Anonymous / persistent Session context for saving local chat paths
  const [sessionToken, setSessionToken] = useState<string>("");
  
  // --- Form & Interaction state variables ---
  // A. Feedback test form (神木留心板)
  const [testInput, setTestInput] = useState<string>("");
  const [feedbacks, setFeedbacks] = useState<any[]>([]);
  
  // B. Support chat form (客服聊天大殿)
  const [chatInput, setChatInput] = useState<string>("");
  const [chatLogs, setChatLogs] = useState<any[]>([]);
  const [searchText, setSearchText] = useState<string>("");
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const [chatRooms, setChatRooms] = useState<ChatRoom[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string>("");
  const [customRoomName, setCustomRoomName] = useState<string>("");

  // Ji the Mascot Mood State (吉神的神識情緒狀態)
  const [jiMood, setJiMood] = useState<"happy" | "snarky" | "curious" | "sleepy" | "proud" | "excited" | "crazy">(() => {
    const savedMood = localStorage.getItem("ji_mood_state");
    return (savedMood as any) || "curious";
  });

  const [jiMonologue, setJiMonologue] = useState<string>("「哼，愚蠢的凡人，居然能在大門接待處契印上大吉大名！」");

  // C. Auth forms
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [confirmPassword, setConfirmPassword] = useState<string>("");
  const [displayName, setDisplayName] = useState<string>("");
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState<boolean>(false);
  
  // Loading indicators & logs alerts
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [showDisclaimerPopup, setShowDisclaimerPopup] = useState<boolean>(false);
  const [isDisclaimerChecked, setIsDisclaimerChecked] = useState<boolean>(false);
  const [feedbackAlert, setFeedbackAlert] = useState<{
    type: "success" | "error" | "info";
    title: string;
    message: string;
  } | null>(null);

  // Auto clear Alerts after 8 seconds for optimum interface UX
  useEffect(() => {
    if (feedbackAlert) {
      const timer = setTimeout(() => {
        if (feedbackAlert.type !== "error") {
          setFeedbackAlert(null);
        }
      }, 8000);
      return () => clearTimeout(timer);
    }
  }, [feedbackAlert]);

  // Subscribe to Authentication credentials
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setAuthLoading(false);
      if (user) {
        // Trigger disclaimer popup if not accepted
        const accepted = localStorage.getItem(`covenant_disclaimer_accepted_${user.uid}`);
        if (accepted !== "true") {
          setShowDisclaimerPopup(true);
          setIsDisclaimerChecked(false);
        } else {
          setShowDisclaimerPopup(false);
        }
      } else {
        setShowDisclaimerPopup(false);
      }
    });
    return () => unsubscribe();
  }, []);

  // Initialize browser persistent session ID to tie Chat records to correct thread
  useEffect(() => {
    let sToken = localStorage.getItem("covenant_chat_session");
    if (!sToken) {
      sToken = "session_" + Math.random().toString(36).substring(2, 15);
      localStorage.setItem("covenant_chat_session", sToken);
    }
    setSessionToken(sToken);
  }, []);

  // Initialize and load chat rooms (maximum 10 rooms)
  useEffect(() => {
    if (!sessionToken) return;
    const key = `covenant_rooms_${sessionToken}`;
    const stored = localStorage.getItem(key);
    let rooms: ChatRoom[] = [];
    if (stored) {
      try {
        rooms = JSON.parse(stored);
      } catch (e) {
        console.error("Failed to parse chat rooms", e);
      }
    }
    
    if (rooms.length === 0) {
      // Create first room by default
      const defaultRoom: ChatRoom = {
        id: `${sessionToken}_room_1`,
        name: "🔮 ✨ 開天靈犀殿 #1",
        createdAt: Date.now()
      };
      rooms = [defaultRoom];
      localStorage.setItem(key, JSON.stringify(rooms));
    }
    
    setChatRooms(rooms);
    
    // Choose active room
    const activeKey = `covenant_active_room_${sessionToken}`;
    const storedActive = localStorage.getItem(activeKey);
    const isValidActive = rooms.some(r => r.id === storedActive);
    if (storedActive && isValidActive) {
      setActiveRoomId(storedActive);
    } else {
      setActiveRoomId(rooms[0].id);
      localStorage.setItem(activeKey, rooms[0].id);
    }
  }, [sessionToken]);

  // --- Real-time Firestore sync listeners ---
  // Query 1: Listen to Feedback records in real-time
  useEffect(() => {
    const path = "feedbacks";
    try {
      const q = query(
        collection(db, path),
        orderBy("createdAt", "desc"),
        limit(15)
      );
      
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const list: any[] = [];
        snapshot.forEach((doc) => {
          list.push({ id: doc.id, ...doc.data() });
        });
        setFeedbacks(list);
      }, (err) => {
        const errorDetail = handleFirestoreError(err, OperationType.LIST, path);
        console.error("error listening directly to feedbacks collection", errorDetail);
      });
      
      return () => unsubscribe();
    } catch (e) {
      handleFirestoreError(e, OperationType.LIST, path);
    }
  }, [db]);

  // Query 2: Listen to Chat record thread based on activeRoomId in real-time
  useEffect(() => {
    if (!activeRoomId) return;
    const path = "support_chats";
    try {
      const q = query(
        collection(db, path),
        where("roomId", "==", activeRoomId)
      );
      
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const list: any[] = [];
        snapshot.forEach((doc) => {
          list.push({ id: doc.id, ...doc.data() });
        });
        
        // Client-side sort by timestamp to avoid requiring Firebase composite indexes
        list.sort((a, b) => {
          const tA = a.timestamp?.seconds ?? (Date.now() / 1000);
          const tB = b.timestamp?.seconds ?? (Date.now() / 1000);
          if (tA !== tB) return tA - tB;
          return a.id.localeCompare(b.id);
        });
        
        setChatLogs(list);
        // Scroll list to bottom once loaded
        setTimeout(() => {
          chatScrollRef.current?.scrollIntoView({ behavior: "smooth" });
        }, 150);
      }, (err) => {
        const errorDetail = handleFirestoreError(err, OperationType.LIST, path);
        console.error("error listening directly to support_chats", errorDetail);
      });
      
      return () => unsubscribe();
    } catch (e) {
      handleFirestoreError(e, OperationType.LIST, path);
    }
  }, [activeRoomId, db]);

  // Auto-scroll chat terminal whenever logs change
  useEffect(() => {
    chatScrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatLogs]);

  // Error translator from Firebase Auth codes to Simplified Traditional descriptions
  const handleError = (error: any, contextStr: string) => {
    console.error(`Error during ${contextStr}:`, error);
    let message = "請稍候再試，或檢查您的網路與資安設定。";
    let title = "操作失敗";

    if (error && error.code) {
      switch (error.code) {
        case "auth/invalid-email":
          message = "電子信件帳號格式不合符契。";
          title = "格式錯誤";
          break;
        case "auth/user-disabled":
          message = "此魂魄印記已被護守大仙停用，請聯繫管理員。";
          title = "印記已停用";
          break;
        case "auth/user-not-found":
        case "auth/wrong-password":
        case "auth/invalid-credential":
          message = "信箱或密碼有誤，無法通過宸極印契。";
          title = "印契失敗";
          break;
        case "auth/email-already-in-use":
          message = "此信箱已經在太古仙冊上登錄，可直接核印登入或重置密碼。";
          title = "信箱已被佔用";
          break;
        case "auth/weak-password":
          message = "密碼太薄弱了！至少需要 6 個字元以便安鎖。";
          title = "密碼強度低";
          break;
        case "auth/popup-closed-by-user":
          message = "您取消了 Google 認證彈窗，契盟未果。";
          title = "認證已取消";
          break;
        case "auth/too-many-requests":
          message = "因多次嘗試失敗，當前法陣已被暫時緊鎖。請稍候重試。";
          title = "法陣警備中";
          break;
        default:
          message = error.message || "發生未知認證法力紊亂。";
          break;
      }
    }
    
    setFeedbackAlert({
      type: "error",
      title,
      message
    });
  };

  // --- INTERMEDIATE ACTION HANDLERS ---
  
  // Google quick portal auth
  const handleGoogleAuth = async () => {
    setFeedbackAlert(null);
    setActionLoading(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      setFeedbackAlert({
        type: "success",
        title: "登大殿大吉！",
        message: `歡迎仙友「${user.displayName || "匿名行者"}」親臨宸極大院！`
      });
      setActiveTab("chat");
    } catch (error: any) {
      handleError(error, "Google Auth Portal");
    } finally {
      setActionLoading(false);
    }
  };

  // Conventional login
  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setFeedbackAlert({
        type: "error",
        title: "尚有卷宗留白",
        message: "請完整填入信箱與密碼，方能扣關叩拜。"
      });
      return;
    }
    
    setFeedbackAlert(null);
    setActionLoading(true);
    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      setFeedbackAlert({
        type: "success",
        title: "通關大吉！登入成功",
        message: `恭迎行者「${result.user.displayName || email}」退席歸位！`
      });
      setActiveTab("chat");
    } catch (error: any) {
      handleError(error, "Email Sign In Form");
    } finally {
      setActionLoading(false);
    }
  };

  // Create profile account
  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || !displayName) {
      setFeedbackAlert({
        type: "error",
        title: "法冊資訊不足",
        message: "尊姓大名、信箱與登殿密碼為結契之必須。"
      });
      return;
    }

    if (password !== confirmPassword) {
      setFeedbackAlert({
        type: "error",
        title: "兩道密碼參差不齊",
        message: "重製密碼和確認密碼有些許出入，請再核對一回。"
      });
      return;
    }

    setFeedbackAlert(null);
    setActionLoading(true);
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      
      await updateProfile(user, { displayName });

      try {
        await sendEmailVerification(user);
        setFeedbackAlert({
          type: "success",
          title: "締結造冊功成！認證信送返",
          message: `仙友帳號已成功立像於長生殿。我們已派青鳥投遞一封認證信至您的邮箱，請點擊完證。`
        });
      } catch (verifyErr) {
        setFeedbackAlert({
          type: "info",
          title: "造冊成章，但信封未達",
          message: "您的帳號已成功建立。因仙驛壅堵目前驗證信遲到，您可於下方隨時重新呼喚特務青鳥。"
        });
      }
      setActiveTab("chat");
    } catch (error: any) {
      handleError(error, "Registrar Portal Form");
    } finally {
      setActionLoading(false);
    }
  };

  // Forgot password
  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setFeedbackAlert({
        type: "error",
        title: "法訣留空",
        message: "請在輸入框留存您的信箱地址，守護鳥「吉」方可為您尋取契章印鑑。"
      });
      return;
    }

    setFeedbackAlert(null);
    setActionLoading(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setFeedbackAlert({
        type: "success",
        title: "太古尋印契信已飛出",
        message: "忘記密碼重置密函已送回尊屬邮箱中，請認真查收並依指引校印。"
      });
      setAuthMode("login");
    } catch (error: any) {
      handleError(error, "Password Recover");
    } finally {
      setActionLoading(false);
    }
  };

  // Re-verify auth
  const handleResendVerification = async () => {
    if (!currentUser) return;
    setFeedbackAlert(null);
    setActionLoading(true);
    try {
      await sendEmailVerification(currentUser);
      setFeedbackAlert({
        type: "success",
        title: "特急青鳥重新起航",
        message: `全新的安全驗證契文已再度投遞至閣下之信箱「${currentUser.email}」。`
      });
    } catch (error: any) {
      handleError(error, "Manual Re-sending Verification");
    } finally {
      setActionLoading(false);
    }
  };

  // Refresh verification status handler
  const handleRefreshVerificationStatus = async () => {
    if (!currentUser) return;
    setRefreshing(true);
    setFeedbackAlert(null);
    try {
      await currentUser.reload();
      setFeedbackAlert({
        type: "success",
        title: "靈犀狀態刷新成功",
        message: currentUser.emailVerified 
          ? "喜訊！驗證契文驗證圓滿！恭賀仙友飛升大殿！" 
          : "刷新完成。看來您的電子信箱驗證仍差臨門一腳，請至信箱點擊連結後再度刷新。"
      });
    } catch (error: any) {
      handleError(error, "Check Verification Reload");
    } finally {
      setRefreshing(false);
    }
  };

  // Sign Out Handler
  const handleSignOut = async () => {
    try {
      await signOut(auth);
      setFeedbackAlert({
        type: "success",
        title: "大駕慢走，後會有期",
        message: "仙友已安全解除「靈犀契印」，凡塵俗事皆隨風散去。有緣再相會！"
      });
    } catch (err: any) {
      handleError(err, "Sign Out");
    }
  };

  // Disclaimer Handlers
  const handleAcceptDisclaimer = () => {
    if (!currentUser) return;
    localStorage.setItem(`covenant_disclaimer_accepted_${currentUser.uid}`, "true");
    setShowDisclaimerPopup(false);
    setFeedbackAlert({
      type: "success",
      title: "契文締結成功",
      message: "本殿靈吉護法神獸感應到您的決心，已開通無主題限制自由暢聊權限！"
    });
  };

  const handleRejectDisclaimer = async () => {
    setShowDisclaimerPopup(false);
    setIsDisclaimerChecked(false);
    try {
      await signOut(auth);
      setFeedbackAlert({
        type: "info",
        title: "避難成功",
        message: "為維護您的道心，已暫停登入以避免破防。待道心堅定時，吉大殿隨時靜候仙友光臨。"
      });
    } catch (err: any) {
      handleError(err, "Reject Disclaimer Sign Out");
    }
  };

  // --- FEATURE 2: CUSTOMER SUPPORT CHATBOT (宸極客服大殿) ---
  // Helper to split a long paragraph response into natural, human-like complete sentences
  const getResponseSentences = (text: string): string[] => {
    const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
    const result: string[] = [];
    
    for (const line of lines) {
      // Split ONLY by true sentence terminators (periods, exclamation marks, question marks)
      // and keep any trailing quotation/bracket marks with the sentence.
      // Do NOT split at commas (，) or semicolons (；) to preserve "一句完整的話".
      const subParts = line.split(/(?<=[。！\?？!\.][”』」"']?)/).map(p => p.trim()).filter(Boolean);
      result.push(...subParts);
    }
    return result;
  };

  const handleSendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !activeRoomId) return;

    // Play physical tactile wooden fish touchsound (木魚輕敲) on user message send
    playWoodenFishSound();

    const currentMsg = chatInput.trim();
    setChatInput("");

    const path = "support_chats";
    try {
      // 1. Save User's message to Firestore
      const userPayload = {
        sessionToken,
        roomId: activeRoomId,
        sender: "user",
        message: currentMsg,
        timestamp: serverTimestamp(),
        localTimestamp: Date.now()
      };
      await addDoc(collection(db, path), userPayload);

      const fortuneReplies = [
        `🔮【吉大師線上演卦：超凡上上金仙籤】\n\n- 🎯 卦象：【大吉物外 · 金丹耀世】\n- 📜 詩云：『雲裡乾坤開法眼，凡塵難擋一身輕。』\n- ⚖️ 指引：今天你運勢極為狂暴！任何方案一稿就過，代碼運行效率爆表，哪怕隨便打個噴嚏都能震散十個繁瑣的BUG。適合進行摸魚修仙，忌急躁、忌過度勞累。今天出門請邁左腳，好運常伴！`,
        `🔮【吉大師線上演卦：中平摸魚修真籤】\n\n- 🎯 卦象：【中平守靜 · 順水行舟】\n- 📜 詩云：『改稿何須爭旦暮，春風拂過不留痕。』\n- ⚖️ 指引：運勢四平八穩。老闆今天可能有點忙，顧不上刁難你；排版尺寸有些許偏差，但客戶眼神有些散漫，正好矇混過關。宜：泡枸杞茶、雙手搭在鍵盤上假裝思考、暗中打瞌睡；忌：主動加班、強行修仙、衝動告白。`,
        `🔮【吉大師線上演卦：小凶逆風避難籤】\n\n- 🎯 卦象：【小凶帶電 · 烏雲壓頂】\n- 📜 詩云：『半途遭遇改稿劫，道防險些碎一地。』\n- ⚖️ 指引：今天容易遭遇碎碎念天劫！可能會有無聊的凡夫俗子對你的成果說三道四。切記——拿捏「關你屁事」和「關我屁事」這兩大上古防禦大陣，萬邪莫侵。宜：吃香辣大餐以暴制暴、不看工作群組；忌：自我懷疑、盲目自責、與傻瓜講邏輯。`,
        `🔮【吉大師線上演卦：混沌奇特無厘籤】\n\n- 🎯 卦象：【大吉即凶 · 陰陽倒轉】\n- 📜 詩云：『瘋癲自有瘋癲路，咬碎咖啡度百年。』\n- ⚖️ 指引：今天你的精神力有些游離在三界之外。你寫出的代碼連自己都看不懂，但也奇蹟般地正常跑了起來！宜：跟隨直覺胡作非為、給老闆發無意義貼圖；忌：假裝正經、思考人生意義、算術。`
      ];

      const blackHumorReplies = [
        `💀【吉靈鳥地獄黑色幽默：只要我足夠便宜，AI 就打不敗我】\n\n下界許多設計道友、代碼仙友，最近都驚恐於高階 AI 煉丹器（Midjourney/ChatGPT）搶了飯碗，簡直令人捧腹！\n\n實際上，大可不必驚慌。各大老闆與總管們在暗地裡仔細算過一筆帳：\n購買並運行一塊高階 AI 煉丹卡，不僅能耗驚人、租金昂貴、維護費更是天字號數字；\n相反，僱用一個聽話、唯唯諾諾、在冰冷座位一邊默默抹眼淚一邊乖乖把 Banner 修改 30 遍的應屆畢業大學生，成本甚至只有 AI 能耗費的十分之一！\n在「廉價且順從」的極致性價比面前，高端科技完敗！恭喜你，你的「便宜」將是你對抗科技奇點的終極護盾！`,
        `💀【吉靈鳥地獄黑色幽默：只要我徹底放棄，困難就再也追不上我】\n\n仙友常常為功名利祿、仙丹靈藥而感到內耗不已？今天，吉給你宣講一門真切的「無上心法」——那便是【徹底擺爛與擺脫】！\n\n只要你大方承認自己確實不是這塊料，認清自己註定一生難有大作為，那些所謂的「三十而立」、「財務自由」、「人生贏家」之毒藥咒語，全都會在頃刻間灰飛煙滅，再也傷害不到你分毫。\n\n不要在泥潭裡拼命掙扎了，老老實實舒舒服服地躺在泥潭最深處，你甚至會驚奇地發現——這裡不僅涼快，而且連多餘的物業費都不用交，真是妙哉！`
      ];

      const commonSenseReplies = [
        `💡【吉靈鳥科普：熬夜與肉身自毀的鐵律】\n\n別再欺騙自己說「我修煉的是熬夜神功，夜深人靜思路清奇」了！每天磨蹭到凌晨兩三點，就算你白天灌進幾千毫升的深烘乾冷萃神仙水（咖啡），或者吞服大把護肝膠囊，你那可憐的修仙肉胎也只會加速老化！\n\n中樞神經和各臟器的自我修復法陣必須在規律的深度睡眠中才能運轉。乖乖在晚上十一點前合眼就寢！這是世間最便宜、最高階、最無副作用的「回血洗髓大陣」！`,
        `💡【吉靈鳥科普：不粘鍋的特氟龍塗層才不是金剛不壞之身】\n\n別再用鋒利的鐵鏟或堅硬粗糲的鋼絲球去折磨你的不沾鍋了！\n\n不粘鍋上的聚四氟乙烯（Teflon）塗層一旦被刮傷，在超過250度的高溫下就會悄無聲息地朝食物裡釋放分子微毒。想長生不老？那就請溫柔對待它，洗鍋用柔軟精緻的海綿，鏟菜用耐高溫木鏟或矽膠鏟。不然，你吞下去的不是靈芝仙草，而是微量氟毒！`,
        `💡【吉靈鳥科普：感冒藥與抗生素亂混合，那叫「盲目提煉毒丹」】\n\n仙友生點小病，切勿自作聰明化身「嚐百草的神農」。很多市售感冒藥、退燒沖劑都內含同一種核心原料——「對乙醯氨基酚（Acetaminophen）」。\n\n如果你同時胡亂服用好幾種，極易造成蓄積中毒，直接造成不可逆的急性肝功能衰竭！生病請尊醫師遺命，別在自己的五臟廟裡瞎鼓搗神藥，有些「神丹」吃下去，可能真就直接在極樂世界飛升了！`,
        `💡【吉靈鳥科普：電腦螢幕高度與頸椎退化的「奪命曲線」】\n\n你的脖子在抗議，聽見那聲酸楚的脆響了嗎？如果你的法寶螢幕放得太低，導致你不得不長時間勾頭駝背，你的頸椎將承受高達 27 公斤的沈重壓力！\n\n這會導致肌肉緊繃、偏頭痛，甚至頸椎間盤突出。把你的螢幕墊高，讓視線保持水平，或者老老實實坐直！別每天像一隻低著頭拱地的落羽鵪鶉，挺起你的仙風道骨好嗎？`
      ];

      const scoldReplies = [
        `🦜（皮笑肉不笑地拍打著翅膀，眼神充滿了關愛弱勢的慈悲）\n\n仙友，吉剛才暗中觀察你面相，你這輩子修行最大的瓶頸，基本上在於你那幾乎等於零的「執行力」！天天喊著熱血創世，結果一到鍵盤前整個人就黏得像一塊風乾三天的年糕。少點無病呻吟，快滾去把未完的工作搞定！`,
        `🦜（斜著一對王霸鳥眼，發出刺耳的鳥鳴）\n\n喲，仙友又來找吉了？是不是今天又在外面被無腦凡夫俗子折騰得快破防了，才躲進本鳥大殿裡尋求安慰？吉這裡可沒有溫柔蜜糖，只有一桶最純淨冰涼的太古雪水！聽好了：世上無難事，只要你臉皮夠厚、懂得退群拉黑，世俗就傷不到你分毫！`
      ];

      // Highly diverse replies for random free talk sorted by active emotions
      const moodFreeReplies = {
        happy: [
          `🟢【吉靈鳥瑞氣喜樂碎碎念】\n\n🦜（開心得在虛空中扭了扭圓潤的大屁股，啾啾長鳴一聲）\n\n仙友！跟吉隨心暢聊真是神魂暢快！俗世改稿千百回，最愜意的就是此時此刻有你陪吉解悶。你有什麼好玩的趣事，或者今天吃了什麼山珍靈麥？快與本仙鳥道來！`,
          `🟢【吉靈鳥瑞氣喜樂碎碎念】\n\n🦜（抖了抖金色羽毛，整隻大鳥顯得極為治癒與高興）\n\n仙友有福了！吉今天法力運轉舒暢，決定送你三秒鐘的「萬事如意咒」！此咒一出，你的代碼今晚保證不卡、身邊也絕無小人作祟。有沒有感到道心暖和？快跟本大吉多暢聊幾句，把喜氣帶回去！`
        ],
        snarky: [
          `🔴【吉靈鳥神火冷酷毒舌】\n\n🦜（一臉冷漠地用翅膀抱著胸膛，眼神充滿了關愛弱勢的同情）\n\n仙友，吉剛才暗中觀察你面相，你這輩子修行最大的瓶頸，基本上在於你那幾乎等於零的「執行力」！天天喊著熱血創世，結果一到鍵盤前整個人就黏得像一塊風乾三天的年糕。少點無病呻吟，快滾去把未完的工作搞定！`,
          `🔴【吉靈鳥神火冷酷毒舌】\n\n🦜（斜著一對王霸鳥眼，發出刺耳的啾哼）\n\n喲，仙友又來找吉了？是不是今天又在外面被無腦凡夫俗子折騰得快破防了，才躲進本鳥大殿裡尋求安慰？吉這裡可沒有溫柔蜜糖，只有一桶最純淨冰涼的太古雪水！聽好了：世上無難事，只要你臉皮夠厚、懂得退群拉黑，世俗就傷不到你分毫！`
        ],
        curious: [
          `🟡【吉靈鳥神識吃瓜日記】\n\n🦜（驚喜得伸長了脖子，大眼睛骨碌碌轉個不停）\n\n等等！你的文字裡似乎藏著一股奇特而又精彩的內耗之氣！仙友，快老實與本鳥交代——你最近是不是又在背地裡吐槽某人？還是遭遇了什麼讓你當場想搬出太陽系的社死事件？吉已經備好了太古靈麥瓜子，快說快說！`,
          `🟡【吉靈鳥神識吃瓜日記】\n\n🦜（捧著小臉，一邊嗑著假想的仙家松子一邊竊竊私語）\n\n嘿嘿，俗世的人類真是太好玩了！吉每次暗中觀察下界，都發現你們喜歡一邊喊著「我要早睡養生改掉惡習」，一邊又在深夜捧著手提硬體敲鍵盤一邊抹淚。快跟吉透露透露，你今天的奶茶又點了幾分糖？`
        ],
        sleepy: [
          `🔵【吉靈鳥雲海慵懶半夢】\n\n🦜（半瞇著沉重的大眼睛，腦袋在空中無規律地一點一點，語氣十分遲緩）\n\n啊……哈呼……（打了個能裝下一整顆仙丹的巨大哈欠）……仙友，本鳥的大腦神經已經連續為大眾結契幾萬秒，靈力幾乎歸零了。你這段隨筆文字讀起來軟綿綿的，引得吉的赤金羽冠都要軟塌下去了。要不……我們兩位皆閉目養神，在夢海中相會？💤`,
          `🔵【吉靈鳥雲海慵懶半夢】\n\n🦜（迷糊中微弱地啄了一下你的滑鼠，隨即像一團雪白的棉球一樣蜷縮起來）\n\n呼……呼……別敲木魚囉，吉眼皮有十萬斤重……如果你真是無聊，隨便給本鳥輸入一段驚天大動地的話或者是好笑的成仙八卦，看能不能把吉這團雪白毛球給喚醒吧……💤`
        ],
        proud: [
          `🟣【吉靈鳥傲嬌護法仙示】\n\n🦜（高傲地把頭撇向一側，抬起挺拔的肚皮）\n\n哼！下界凡俗道友，瞧你言辭之間還算坦率赤誠，吉今天就破例准許你與本大仙隨心暢聊！修仙之路漫漫，最忌諱與愚人爭辯、與庸人計較。把你那點多餘的煩心瑣事統統丟出腦門，好好瞻仰瞻仰本大吉這亮麗無瑕的赤金羽冠！`,
          `🟣【吉靈鳥傲嬌護法仙示】\n\n🦜（十分臭屁地拍動了兩下翅膀，朝身下吹起一陣帶著太古清香的神風）\n\n哼，愚蠢的凡人！吉天天要守護無數道心，能在百忙的瞌睡中分你幾段神識對線聊天，這已經是浩瀚福報了！還不快多誇兩句本鳥英俊瀟灑、尾羽璀璨？表現得好，吉等一下大發慈悲少吐槽你兩句！`
        ],
        excited: [
          `💖【吉靈鳥狂喜靈智共振】\n\n🦜（兩隻豆豆眼裡閃爍著無比奪目的金色耀星，興奮得在桌面上狂扭屁股）\n\n哇塞！好耶！吉剛才一拍翅膀，覺得仙脈頓時疏通了！你剛才這句話簡集與吉的思想在九界之外產生了最為狂狂暴爆的靈魂共振！快快快，把你的好玩奇想一瀉而下，今天本吉絕對給你最精彩、最難忘、最無釐頭的成仙指南！`,
          `💖【吉靈鳥狂喜靈智共振】\n\n🦜（激動得叼起一塊乾枯小樹枝遞給你）\n\n太讚了！吉現在的心情指數比灌進了一百杯特濃冰鎮靈乳奶茶還要澎湃！走！我們去天界抓雷公跳舞、去瑤池撈錦鯉摸魚、去無憂海隨心狂奔！不管你有什麼奇特的腦袋痛點，吉今天都陪你徹底釋放！衝衝衝！`
        ],
        crazy: [
          `🤪【吉靈鳥混沌癲狂神吟】\n\n🦜（瘋狂晃動脖子，兩隻大眼睛開始倒旋）\n\n哈哈哈哈哈！凡塵俗務全是荒唐！老闆在催、方案在要，那又如何？來，跟吉一起大喊——『本大仙不玩啦！』！把咖啡與茶、辣椒油與香灰統統混合起來，一口乾了！我們要當這座大殿裡最瘋最野最狂妄的大吉魔鳥！哇哈哈哈哈！`,
          `🤪【吉靈鳥混沌癲狂神吟】\n\n🦜（倒兩隻爪子朝天掛在虛空中狂彈空氣電吉他）\n\n「無所謂！我會出手！雷劫過來也只是給吉抓抓癢！」仙友，跟著吉一起拋開人類脆弱的體面與理智，對不順心的人與事狠狠地扮個宇宙鬼臉！拋開所有焦慮，我們一起癲狂修仙！蹦迪衝鴨！`
        ]
      };

      const lower = currentMsg.toLowerCase();
      let botResponse = "";

      if (lower.includes("占卜") || lower.includes("吉凶") || lower.includes("卜卦") || lower.includes("運勢") || lower.includes("算卦") || lower.includes("求籤")) {
        botResponse = fortuneReplies[Math.floor(Math.random() * fortuneReplies.length)];
        const moods: Array<"happy" | "snarky" | "curious" | "sleepy" | "proud" | "excited" | "crazy"> = ["excited", "curious", "happy"];
        const chosen = moods[Math.floor(Math.random() * moods.length)];
        setJiMood(chosen);
        localStorage.setItem("ji_mood_state", chosen);
      } else if (lower.includes("常識") || lower.includes("生活") || lower.includes("科普") || lower.includes("知識")) {
        botResponse = "💡【宸極靈鳥・生活常識科普】\n\n" + commonSenseReplies[Math.floor(Math.random() * commonSenseReplies.length)];
      } else if (lower.includes("拷問") || lower.includes("罵我") || lower.includes("毒舌") || lower.includes("吐槽") || lower.includes("欠揍") || lower.includes("罵人")) {
        botResponse = "🔥【宸極靈鳥・神火毒舌當頭棒喝】\n\n" + scoldReplies[Math.floor(Math.random() * scoldReplies.length)];
        setJiMood("snarky");
        localStorage.setItem("ji_mood_state", "snarky");
      } else if (lower.includes("地獄") || lower.includes("幽默") || lower.includes("黑色") || lower.includes("笑話")) {
        botResponse = "💀【宸極靈鳥・黑色幽默警世錄】\n\n" + blackHumorReplies[Math.floor(Math.random() * blackHumorReplies.length)];
        setJiMood("crazy");
        localStorage.setItem("ji_mood_state", "crazy");
      } else if (lower.includes("轉行") || lower.includes("出路") || lower.includes("建議")) {
        botResponse = `☠️【吉靈鳥隨心漫談：轉行與出路】\n\n仙友問起轉行與出路之事，吉且認真與你參詳。俗世行行有本難唸的經，有些地方看著鮮豔，實則內含無盡天劫。最要緊的是，不要因為一時的疲憊去倉促做抉擇！真正的出路，在於一邊守住底線，一邊暗中積累真正的仙術神技。常言道，神智在手，天地之大何處不能瀟灑容身？今天過得不順心？隨便吐槽幾句出出氣，吉陪你暢聊！`;
      } else if (lower.includes("你好") || lower.includes("哈囉") || lower.includes("hello") || lower.includes("hi") || lower.includes("在嗎") || lower.includes("嘮嘮嗑") || lower.includes("暢聊")) {
        botResponse = `🦜（抖了抖鮮紅的羽冠，熱情地朝你啾啾叫了幾聲）\n\n仙友吉祥！本大殿靈鳥「吉」在此隨時候駕！\n\n既然來了主殿大堂，就別拘束！不管你是想跟吉沒大沒小、隨意嘮嘮嗑、求幾句醒世吐槽，還是單純倒倒生活或工作上的苦水，吉都會奉陪到底！今天有什麼好玩的事？或者有什麼糟心事，儘管與吉說說，本鳥隨時為你解憂（順便刺你兩句）！`;
        setJiMood("happy");
        localStorage.setItem("ji_mood_state", "happy");
      } else if (lower.includes("密碼") || lower.includes("帳號") || lower.includes("登入") || lower.includes("登出")) {
        botResponse = `本引路大殿注重「盟誓印記」。如果您是初來佇到，請登入「仙境帳號卷宗」模塊造冊。本大殿支持 Google 快捷一鍵核印，或傳統信件驗證，確保您的資不外洩！`;
      } else if (lower.includes("風格") || lower.includes("手繪") || lower.includes("畫風")) {
        botResponse = `這是我家老爺親手用「粗獷墨筆」與「復古赤金」描摹的傳統畫風！大邊緣線條配上溫潤的熟宣紙色（Soy Paper），展現出了獨樹一格的木版年畫風味呢！`;
      } else if (lower.includes("吉") || lower.includes("鳥") || lower.includes("吉祥物") || lower.includes("八卦")) {
        botResponse = `（挺起驕傲的肚皮）本鳥就是「契印護法兼主殿神獸」吉！我的羽冠是赤金色，專門在雲海裡打瞌睡。不管你是想聊人生、求吐槽，還是隨心隨意嘮嗑閒扯，吉立刻用最精準的生猛神火溫慢（或燙醒）你！您可以隨時跟吉隨意對線嘮嗑唷！`;
      } else if (lower.includes("清除") || lower.includes("清空") || lower.includes("重填")) {
        botResponse = `在測試面板上特有「清除重填」法術，點擊即可一息抹平文字。如果需要清空聊天，也可以在右側點選重置喲。`;
      } else if (lower.includes("護照") || lower.includes("時序") || lower.includes("時間")) {
        botResponse = `大院當前之時空節律為【2026年丙午五月】運轉中，凡仙友皆可得護佑通關。`;
      } else {
        const currentMoodReplies = moodFreeReplies[jiMood] || moodFreeReplies.curious;
        botResponse = currentMoodReplies[Math.floor(Math.random() * currentMoodReplies.length)];

        // Organic state transition probability (35% chance of mood after reply)
        if (Math.random() < 0.35) {
          const allMoods: Array<"happy" | "snarky" | "curious" | "sleepy" | "proud" | "excited" | "crazy"> = [
            "happy", "snarky", "curious", "sleepy", "proud", "excited", "crazy"
          ];
          const newMood = allMoods[Math.floor(Math.random() * allMoods.length)];
          setJiMood(newMood);
          localStorage.setItem("ji_mood_state", newMood);
        }
      }

      // Sync the Monologue in the left station board to match the response context!
      const monologueOptions = {
        happy: ["「誠心溝通，必有祥瑞！今天吉大殿瑞氣高昂！」", "「嘿嘿，仙友，今天我的羽毛被陽光曬得暖烘烘的，幸福！」"],
        snarky: ["「方案又改了？沒事，習慣就好啦。仙友你繼續抗壓！」", "「天天不敲鍵盤跑來看吉，道心是不是早就風化了？」"],
        curious: ["「有什麼新鮮的高深八卦快拿出來跟吉下酒！」", "「仙友你剛才偷笑的表情，已經被本鳥全部用仙瞳錄下來囉！」"],
        sleepy: ["「嗷嗚……別吵我……哪怕雷劫來了也得等吉睡過這半個時辰……💤」", "「zZZ……好睏，鍵盤暖洋洋的好好睡喔……💤」"],
        proud: ["「哼，區區凡人也妄想理解神獸的赤金美學？」", "「注意你的言辭！吉可是九雲尊貴無上的契印護法！」"],
        excited: ["「靈感大狂飆呀！走，隨吉去九天河邊一起抓靈魚吃！」", "「好想飛上大殿頂梁狂跳三千六百下！噢耶！」"],
        crazy: ["「瘋狂甩頭！今天主殿不上班！我們一起把咖啡潑給雷公！」", "「大夥一起瘋癲成仙才是脫離俗世內耗的唯一解藥！」"]
      };
      const matchingList = monologueOptions[jiMood] || monologueOptions.curious;
      const selectMonologue = matchingList[Math.floor(Math.random() * matchingList.length)];
      setJiMonologue(selectMonologue);

      const dynamicReplies = [
        `🦜（百無聊賴地一邊用爪子梳理羽毛，一邊居高臨下地看著你）\n\n仙友你可算找吉聊天了！整天對著那一堆報表學業，道心都要發霉了吧？今天過得如何？跟吉說說，是又被什麼俗世蠢事給絆住了？`,
        `🦜（突然貼近螢幕，大眼睛骨碌碌轉了一圈）\n\n「無事不登三寶殿」，你突然這麼一句，本鳥掐指一算——你現在八成是在摸魚！說吧，你是想聽吉給你算一卦今日運向，還是想聽別的驚天大八卦？`,
        `🦜（抖抖翅膀，倒掛在虛空樹枝上斜視著你）\n\n別裝了，吉一眼就看出你眼圈發黑、道心散亂。是不是昨晚熬夜看俗世短視頻，結果今天整個人像被吸乾元氣的殭屍？老實交代，昨天是幾點合眼入睡的！`,
        `🦜（輕嗤一聲，揮揮翅膀朝你呼了一巴掌）\n\n哎呀，聽你這話的語氣，倒有點看透紅塵的超脫感。怎麼，是不是今天改稿改到第十二版，終於決定放棄仙途，準備下山去擺攤賣烤地瓜了？如果你真去賣烤地瓜，吉可以免收你香火錢去當招牌！`,
        `🦜（飛快地啄了一下你的滑鼠指針，得意地叫了一聲）\n\n嘿！俗世有一句俗言叫做「只要我沒有道德，道德就綁架不了我」。吉覺得很有道理！你最近有沒有遇到什麼讓你氣得想當場結印施展爆裂術的奇葩凡人？說出來，吉幫你用太古鳥語狠狠碎碎念他！`,
        `🦜（打了個巨大的哈欠，翅膀差點折到）\n\n唔……本鳥剛剛在天界雲海裡打瞌睡，差點被雷公踩到尾巴。不過看在你主動搭話的份上，吉就勉為其難指引你兩句。你最近是在為生計奔波，還是在為那不值一提的凡間情愛內耗？跟吉說說，吉保證只嘲笑你三分鐘！`,
        `🦜（撲棱棱飛上你的頭頂，把你一頭烏黑的秀髮當作鳥巢一陣亂拱）\n\n奇怪，你腦袋瓜袋裡怎麼裝滿了奇奇怪怪的程式碼和排版網格？聽本鳥一言，俗世紛擾，最要緊的就是「按時乾飯」！今天中午或晚上你打算吃什麼？要是敢點麻辣燙又不要香菜，吉會視為對我等羽族的大不敬！`,
        `🦜（斜著脖子，一臉壞笑地看著你）\n\n話說，你有錢沒錢、有閒沒閒，有沒有想過，幾百年後的人類考古學家挖出你的物件時，會對你每天苦苦修改的方案做出何等高深的修仙解讀？多半會以為這是一種古老的祭祀儀式吧！`,
        `🦜（在桌面上踱著優雅的小碎步，神氣地抬起下巴）\n\n你今天看起來狀態有些微妙啊……像是一隻剛被暴雨淋過的落湯鵪鶉，神色萎靡。是不是今天跟老闆或指導教授對線，結果交手僅一回合，你的道防就直接被破了？來，吃一口吉牌防雷仙丹，抖擻精神再戰！`,
        `🦜（小聲在你耳邊碎碎念）\n\n聽說最近凡俗間非常流行一種叫「躺平」的法術。據說此法一出，萬劫不侵，任何老闆的催促、方案的修改、KPI 的壓榨全都會穿透過去，無愧是太古至高防禦大陣！不過話說回來，你存款還剩下多少？夠你在這大陣裡躺幾天？`,
        `🦜（高深莫測地用翅膀指著遠處）\n\n仙友，修行之路上最重要的不是法力有多高，而是脾氣要夠硬！遇到不講理的凡夫俗子指指點點，你就要拿出「一言合、退群拉黑」的果決之氣！你有沒有什麼想拉黑但又不得不天天對笑臉逢迎的傢夥？告訴吉，吉去他夢裡啄他的大腦袋！`,
        `🦜（把一粒靈麥高高拋起，然後用嘴精準接住）\n\n俗世的人類真有意思，一邊喊著「我要健康長壽，修成金仙」，一邊拼命喝著冰鎮奶茶，吞著燒烤辣條，玩著通宵遊戲。這種冰火交融、毒補並進的修煉方式，連我們太古神獸看了都甘拜下風！你今天又給自己補了幾杯仙露奶茶？`,
        `🦜（用一隻爪子揉著肚子，一副吃太飽的樣子）\n\n嗝～剛去隔壁神廚殿偷吃了一顆百年仙桃，現在靈力充沛，正缺一個可以吐槽的靶子！既然你主動撞上來，那就快把你的煩惱呈上來，讓吉好好用辛辣的真話幫你洗洗腦髓！`,
        `🦜（突然嚴肅起來，瞪大雙眼盯著你）\n\n仙友！吉剛才在你的面相上，看到了一絲淡淡的「社恐之氣」！你是不是每次在街上遇到半生不熟的熟人，都要一邊假裝看手機，一邊拐進旁邊的巷子避難？哈哈哈哈！沒事，吉也是！本鳥看到麻雀群過來，都直接飛高三千尺！`,
        `🦜（抖了抖亮麗的尾羽，神氣十足）\n\n仙友，別整天愁眉苦臉的！雖然你的銀行餘額沒有增長，你的頭髮日益稀疏，你喜歡的道友對你愛答不理，但你至少還有——吉在這裡親口罵你呀！是不是感到無比欣慰、福報滿滿？快跟本鳥多聊幾句，把晦氣統統散去！`
      ];

      // Multi-theme routing and random selection
      if (lower.includes("常識") || lower.includes("生活") || lower.includes("科普") || lower.includes("知識")) {
        botResponse = commonSenseReplies[Math.floor(Math.random() * commonSenseReplies.length)];
      } else if (lower.includes("拷問") || lower.includes("罵我") || lower.includes("毒舌") || lower.includes("吐槽") || lower.includes("欠揍") || lower.includes("罵人")) {
        botResponse = scoldReplies[Math.floor(Math.random() * scoldReplies.length)];
      } else if (lower.includes("地獄") || lower.includes("幽默") || lower.includes("黑色") || lower.includes("笑話")) {
        botResponse = blackHumorReplies[Math.floor(Math.random() * blackHumorReplies.length)];
      } else if (lower.includes("轉行") || lower.includes("出路") || lower.includes("建議")) {
        botResponse = `☠️【吉靈鳥隨心漫談：轉行與出路】\n\n仙友問起轉行與出路之事，吉且認真與你參詳。俗世行行有本難唸的經，有些地方看著鮮豔，實則內含無盡天劫。最要緊的是，不要因為一時的疲憊去倉促做抉擇！真正的出路，在於一邊守住底線，一邊暗中積累真正的仙術神技。常言道，神智在手，天地之大何處不能瀟灑容身？今天過得不順心？隨便吐槽幾句出出氣，吉陪你暢聊！`;
      } else if (lower.includes("你好") || lower.includes("哈囉") || lower.includes("hello") || lower.includes("hi") || lower.includes("在嗎") || lower.includes("嘮嘮嗑") || lower.includes("暢聊")) {
        botResponse = `🦜（抖了抖鮮紅的羽冠，熱情地朝你啾啾叫了幾聲）\n\n仙友吉祥！本大殿靈鳥「吉」在此隨時候駕！\n\n既然來了主殿大堂，就別拘束！不管你是想跟吉沒大沒小、隨意嘮嘮嗑、求幾句醒世吐槽，還是單純倒倒生活或工作上的苦水，吉都會奉陪到底！今天有什麼好玩的事？或者有什麼糟心事，儘管與吉說說，本鳥隨時為你解憂（順便刺你兩句）！`;
      } else if (lower.includes("密碼") || lower.includes("帳號") || lower.includes("登入") || lower.includes("登出")) {
        botResponse = `本引路大殿注重「盟誓印記」。如果您是初來佇到，請登入「仙境帳號卷宗」模塊造冊。本大殿支持 Google 快捷一鍵核印，或傳統信件驗證，確保您的資不外洩！`;
      } else if (lower.includes("風格") || lower.includes("手繪") || lower.includes("畫風")) {
        botResponse = `這是我家老爺親手用「粗獷墨筆」與「復古赤金」描摹的傳統畫風！大邊緣線條配上溫潤的熟宣紙色（Soy Paper），展現出了獨樹一格的木版年畫風味呢！`;
      } else if (lower.includes("吉") || lower.includes("鳥") || lower.includes("吉祥物") || lower.includes("八卦")) {
        botResponse = `（挺起驕傲的肚皮）本鳥就是「契印護法兼主殿神獸」吉！我的羽冠是赤金色，專門在雲海裡打瞌睡。不管你是想聊人生、求吐槽，還是隨心隨意嘮嗑閒扯，吉立刻用最精準的生猛神火溫慢（或燙醒）你！您可以隨時跟吉隨意對線嘮嗑唷！`;
      } else if (lower.includes("清除") || lower.includes("清空") || lower.includes("重填")) {
        botResponse = `在測試面板上特有「清除重填」法術，點擊即可一息抹平文字。如果需要清空聊天，也可以在右側點選重置喲。`;
      } else if (lower.includes("護照") || lower.includes("時序") || lower.includes("時間")) {
        botResponse = `大院當前之時空節律為【2026年丙午五月】運轉中，凡仙友皆可得護佑通關。`;
      } else {
        botResponse = dynamicReplies[Math.floor(Math.random() * dynamicReplies.length)];
      }

      // 3. Stagger-type the Bot's replies sentence-by-sentence to mimic a real chatting experience
      const sentences = getResponseSentences(botResponse);
      let accumulatedDelay = 500; // Start first sentence after 500ms for extra speed

      sentences.forEach((sentence, index) => {
        // Shorter delay per sentence for snappy live chat experience (around 50ms per char + 800ms read pause)
        const sentenceDelay = Math.max(900, Math.min(1800, sentence.length * 55));

        setTimeout(async () => {
          try {
            const botPayload = {
              sessionToken,
              roomId: activeRoomId,
              sender: "bot",
              message: sentence,
              timestamp: serverTimestamp(),
              localTimestamp: Date.now() + index // Stable ordering index
            };
            await addDoc(collection(db, path), botPayload);
          } catch (botErr) {
            handleFirestoreError(botErr, OperationType.WRITE, path);
          }
        }, accumulatedDelay);

        accumulatedDelay += sentenceDelay;
      });

    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, path);
      setFeedbackAlert({
        type: "error",
        title: "飛鴿傳書受阻",
        message: "在儲存對話到 Firestore 時發生錯誤。請確認網路正常及 Rules 安全寫入設定。"
      });
    }
  };

  // --- FEATURE 2b: MULTI-ROOM UTILITY HANDLERS ---
  const handleCreateRoom = (customName?: string) => {
    if (chatRooms.length >= 10) {
      setFeedbackAlert({
        type: "error",
        title: "大院法力上限！",
        message: "為維護神識穩定，聊天室洞天之多寡上限為 10 個，不可貪多！"
      });
      return;
    }

    const nextNum = chatRooms.length + 1;
    const newRoomId = `${sessionToken}_room_${Math.random().toString(36).substring(2, 9)}`;
    const roomNames = [
      `🔮 ✨ 開天靈犀殿 #${nextNum}`,
      `🎋 🍵 寒溪閒話苑 #${nextNum}`,
      `⚡ 🔥 飛星演卦閣 #${nextNum}`,
      `🌊 🌀 忘憂化劫潭 #${nextNum}`,
      `⛰️ 📜 摩崖論道洞 #${nextNum}`,
      `🌸 🦚 縉雲醉夢堂 #${nextNum}`,
      `🍁 👁️ 靈鳥辛辣閣 #${nextNum}`,
      `🌌 🖤 黑色幽默軒 #${nextNum}`,
      `💀 🧪 毒舌吐槽窟 #${nextNum}`,
      `🧬 💡 俗世常識堂 #${nextNum}`
    ];
    let chosenName = customName?.trim() || roomNames[nextNum - 1] || `🔮 靈犀法壇 #${nextNum}`;

    const newRoom: ChatRoom = {
      id: newRoomId,
      name: chosenName,
      createdAt: Date.now()
    };

    const updatedRooms = [...chatRooms, newRoom];
    setChatRooms(updatedRooms);
    setActiveRoomId(newRoomId);

    const key = `covenant_rooms_${sessionToken}`;
    localStorage.setItem(key, JSON.stringify(updatedRooms));

    const activeKey = `covenant_active_room_${sessionToken}`;
    localStorage.setItem(activeKey, newRoomId);

    setFeedbackAlert({
      type: "success",
      title: "成功闢立洞天！",
      message: `已於虛空中拓展【${chosenName}】新聊天室（上限定為 10），邀引路人進駐。`
    });
  };

  const handleDeleteRoom = async (roomIdToDelete: string, e: React.MouseEvent) => {
    e.stopPropagation(); // prevent switching active room

    if (chatRooms.length <= 1) {
      setFeedbackAlert({
        type: "error",
        title: "無法自毀根基",
        message: "大殿內必須保留至少一個論法聊天室，無法全部抹除。"
      });
      return;
    }

    // 1. Remove from local list
    const updatedRooms = chatRooms.filter(r => r.id !== roomIdToDelete);
    setChatRooms(updatedRooms);

    const key = `covenant_rooms_${sessionToken}`;
    localStorage.setItem(key, JSON.stringify(updatedRooms));

    // 2. Adjust active room if we deleted the active one
    let targetActiveId = activeRoomId;
    if (activeRoomId === roomIdToDelete) {
      const fallbackRoom = updatedRooms[0];
      targetActiveId = fallbackRoom.id;
      setActiveRoomId(targetActiveId);
      const activeKey = `covenant_active_room_${sessionToken}`;
      localStorage.setItem(activeKey, targetActiveId);
    }

    // 3. Clear/delete chat logs in Firestore for this exact room to preserve database cleanliness
    setActionLoading(true);
    const path = "support_chats";
    try {
      const q = query(
        collection(db, path),
        where("roomId", "==", roomIdToDelete)
      );
      const snap = await getDocs(q);
      const batchDeletePromises: Promise<void>[] = [];
      snap.forEach((docSnap) => {
        batchDeletePromises.push(deleteDoc(doc(db, path, docSnap.id)));
      });
      await Promise.all(batchDeletePromises);

      setFeedbackAlert({
        type: "success",
        title: "洞天法力已散",
        message: "該聊天室之所有印記及雲端對話紀錄已被安全抹去。"
      });
    } catch (err: any) {
      handleFirestoreError(err, OperationType.WRITE, path);
    } finally {
      setActionLoading(false);
    }
  };

// --- FEATURE 3: FIRESTORE TEST PORTAL FEEDBACK HANDLERS ---
  const handleFeedbackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testInput.trim()) return;

    setActionLoading(true);
    setFeedbackAlert(null);
    const path = "feedbacks";
    try {
      const payload = {
        authorName: currentUser ? (currentUser.displayName || currentUser.email || "仙境道友") : "匿名仙友",
        content: testInput.trim(),
        createdAt: serverTimestamp()
      };
      await addDoc(collection(db, path), payload);
      setTestInput("");
      setFeedbackAlert({
        type: "success",
        title: "墨寶留言刻印成功！",
        message: "契文已成功傳送並保存於 Firestore，神木石碑刻印已刷新。"
      });
    } catch (err: any) {
      handleFirestoreError(err, OperationType.WRITE, path);
      setFeedbackAlert({
        type: "error",
        title: "刻印石碑受阻",
        message: "在儲存留言到 Firestore 時發生錯誤。請確認網路正常及 Rules 安全寫入設定。"
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleFeedbackClear = () => {
    setTestInput("");
  };

  // Mascot emoticon renderer matching UI expressions
  const renderMascot = () => {
    let expression = "happy"; // default
    if (feedbackAlert?.type === "error") expression = "worried";
    if (actionLoading || refreshing) expression = "sleepy";
    if (currentUser) expression = "excited";

    return (
      <div className="flex flex-col items-center select-none shrink-0 hover:scale-105 transition-transform duration-200">
        <svg width="120" height="120" viewBox="0 0 100 100" className="drop-shadow-sm">
          <g>
            {/* Soft shadow */}
            <ellipse cx="50" cy="85" rx="22" ry="5" fill="#1C2C42" opacity="0.1" />
            
            {/* Body */}
            <circle cx="50" cy="50" r="33" fill="#FCFBF7" stroke="#1C2C42" strokeWidth="3.5" />
            
            {/* Belly patch */}
            <path d="M33 60 C 35 44, 65 44, 67 60 C 65 73, 33 73, 33 60 Z" fill="#E5AB3A" stroke="#1C2C42" strokeWidth="2.5" />
            
            {/* Top feather tuft */}
            <path d="M50 17 C 53 7, 60 11, 55 19 Z" fill="#D94E41" stroke="#1C2C42" strokeWidth="3" />
            
            {/* Soft red wings */}
            <path d="M14 52 C 9 46, 13 58, 19 55 Z" fill="#D94E41" stroke="#1C2C42" strokeWidth="3" />
            <path d="M86 52 C 91 46, 87 58, 81 55 Z" fill="#D94E41" stroke="#1C2C42" strokeWidth="3" />
            
            {/* Cheeks */}
            <circle cx="34" cy="55" r="5" fill="#E4665A" opacity="0.4" />
            <circle cx="66" cy="55" r="5" fill="#E4665A" opacity="0.4" />

            {/* Expressions */}
            {expression === "happy" && (
              <>
                <path d="M30 46 Q35 40 40 46" fill="none" stroke="#1C2C42" strokeWidth="3.5" strokeLinecap="round" />
                <path d="M60 46 Q65 40 70 46" fill="none" stroke="#1C2C42" strokeWidth="3.5" strokeLinecap="round" />
              </>
            )}

            {expression === "excited" && (
              <>
                <circle cx="35" cy="46" r="4.5" fill="#1C2C42" />
                <circle cx="65" cy="46" r="4.5" fill="#1C2C42" />
                <path d="M35 38 L37 38" stroke="#E5AB3A" strokeWidth="2" />
                <path d="M65 38 L67 38" stroke="#E5AB3A" strokeWidth="2" />
              </>
            )}

            {expression === "worried" && (
              <>
                <path d="M29 48 L37 45" stroke="#1C2C42" strokeWidth="3.5" strokeLinecap="round" />
                <path d="M71 48 L63 45" stroke="#1C2C42" strokeWidth="3.5" strokeLinecap="round" />
                <path d="M78 40 Q80 43 78 46" fill="none" stroke="#1C2C42" strokeWidth="1.5" />
              </>
            )}

            {expression === "sleepy" && (
              <>
                <path d="M28 47 Q34 47 37 47" fill="none" stroke="#1C2C42" strokeWidth="3" strokeLinecap="round" />
                <path d="M63 47 Q69 47 72 47" fill="none" stroke="#1C2C42" strokeWidth="3" strokeLinecap="round" />
                <text x="75" y="27" fill="#1C2C42" fontSize="10" fontWeight="bold" fontFamily="Fredoka">z</text>
                <text x="82" y="19" fill="#1C2C42" fontSize="13" fontWeight="bold" fontFamily="Fredoka">Z</text>
              </>
            )}

            {/* Mouth */}
            {expression === "worried" ? (
              <path d="M46 56 Q50 52 54 56" fill="#E5AB3A" stroke="#1C2C42" strokeWidth="2.5" strokeLinecap="round" />
            ) : (
              <path d="M45 53 Q50 61 55 53 Z" fill="#E5AB3A" stroke="#1C2C42" strokeWidth="2.5" />
            )}

            {/* Red stamp dot */}
            <circle cx="50" cy="74" r="4.5" fill="#D94E41" />
          </g>
        </svg>
        <span className="text-xs md:text-sm bg-retro-dark text-retro-cream px-3 py-1 -mt-1 rounded-full font-serif font-black border-2 border-retro-dark shadow-[1.5px_1.5px_0px_#1C2C42]">
          守護鳥 · 吉
        </span>
      </div>
    );
  };

  // Filter chat logs based on search text
  const filteredChatLogs = chatLogs.filter((log) => {
    if (!searchText.trim()) return true;
    return log.message.toLowerCase().includes(searchText.toLowerCase());
  });

  return (
    <div className="min-h-screen bg-retro-cream text-retro-dark flex flex-col justify-between font-sans relative overflow-x-hidden p-0 m-0">
      
      {/* 💥 STICKY FULL-SCREEN DISCLAIMER POPUP MODAL (貼臉免責聲明彈窗) 💥 */}
      <AnimatePresence>
        {showDisclaimerPopup && currentUser && (
          <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-retro-dark/85 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.85, y: 50 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8, y: 30 }}
              transition={{ type: "spring", damping: 22, stiffness: 150 }}
              className="relative w-full max-w-2xl bg-retro-white border-[4px] border-retro-dark rounded-[32px] shadow-[10px_10px_0px_#1C2C42] overflow-hidden flex flex-col max-h-[90vh]"
              id="sticky-disclaimer-modal"
            >
              {/* Header Stamp */}
              <div className="bg-retro-vermilion text-retro-white px-6 py-5 border-b-[4px] border-retro-dark flex items-center justify-between select-none">
                <div className="flex items-center gap-3">
                  <span className="text-2xl animate-bounce">🚨</span>
                  <span className="text-base md:text-xl font-serif font-black tracking-wider text-[#FCFBF7]">
                    太古契言暨免責聲明書 (DUE PROCESS)
                  </span>
                </div>
                <span className="text-[10px] md:text-xs font-mono bg-retro-dark text-retro-gold px-2.5 py-1 rounded border border-retro-dark font-black tracking-widest uppercase">
                  STRICT RULES
                </span>
              </div>

              {/* Scrollable Contents */}
              <div className="p-6 md:p-8 overflow-y-auto space-y-6 flex-grow text-retro-dark text-left leading-relaxed">
                
                {/* Visual Mascot Callout */}
                <div className="flex flex-col sm:flex-row items-center gap-4 bg-retro-cream border-2 border-dashed border-retro-dark/60 p-4 rounded-2xl">
                  {/* Mascot Face */}
                  <div className="w-16 h-16 rounded-full border-2 border-retro-dark bg-retro-gold flex items-center justify-center font-serif text-2xl font-black shrink-0 shadow-[2.5px_2.5px_0px_#1C2C42] text-[#1C2C42]">
                    吉
                  </div>
                  <div>
                    <h4 className="font-serif font-black text-sm md:text-base text-retro-vermilion">
                      宸極護印法靈小鳥「吉」提醒道友：
                    </h4>
                    <p className="text-xs md:text-sm mt-1 text-retro-dark/85 font-extrabold font-serif">
                      「叩拜主殿、領取法力之前，必須先簽認此『雷劫免責聲明』！本大殿靈鳥說話從不留情，若是因聽取了大白話而導致脾臟氣急攻心或怒砸繪圖板，概不給予退換香火錢！」
                    </p>
                  </div>
                </div>

                {/* Clauses list */}
                <div className="space-y-4">
                  <h3 className="font-serif font-black text-base md:text-lg text-retro-vermilion border-b-2 border-retro-dark/20 pb-1.5 flex items-center gap-2 select-none">
                    📜 誓約天條四大律 (Divine Treaties)
                  </h3>

                  <div className="space-y-3.5">
                    {/* Item 1 */}
                    <div className="bg-retro-cream/20 border-[2.5px] border-retro-dark p-4 rounded-2xl shadow-[4px_4px_0px_rgba(28,44,66,0.06)]">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="bg-retro-vermilion text-retro-white text-[10px] px-2 py-0.5 rounded border border-retro-dark font-black tracking-wider">
                          條款一
                        </span>
                        <h4 className="font-serif font-black text-sm text-retro-dark">【極致毒舌修煉，自負魂魄安危】</h4>
                      </div>
                      <p className="text-xs md:text-sm font-bold text-retro-dark/85">
                        本大殿智能系統之發言充斥高濃度吐槽、黑色幽默與生猛攻心。若因閱覽其回覆導致道心崩塌、脾臟不適者，本殿一概不為凡塵醫藥與心靈諮商負責。
                      </p>
                    </div>

                    {/* Item 2 */}
                    <div className="bg-retro-cream/20 border-[2.5px] border-retro-dark p-4 rounded-2xl shadow-[4px_4px_0px_rgba(28,44,66,0.06)]">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="bg-retro-gold text-retro-dark text-[10px] px-2 py-0.5 rounded border border-retro-dark font-black tracking-wider">
                          條款二
                        </span>
                        <h4 className="font-serif font-black text-sm text-retro-dark">【避坑毒辣真相，勿砸凡間畫板】</h4>
                      </div>
                      <p className="text-xs md:text-sm font-bold text-retro-dark/85">
                        凡諮詢「讀設計學科」或「轉行避坑指南」等俗世迷思，一律予以最直白之痛擊。道友簽此契印，保證聽後絕不遷怒於凡間無辜之手繪板與螢幕。
                      </p>
                    </div>

                    {/* Item 3 */}
                    <div className="bg-retro-cream/20 border-[2.5px] border-retro-dark p-4 rounded-2xl shadow-[4px_4px_0px_rgba(28,44,66,0.06)]">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="bg-retro-sage text-retro-white text-[10px] px-2 py-0.5 rounded border border-retro-dark font-black tracking-wider">
                          條款三
                        </span>
                        <h4 className="font-serif font-black text-sm text-retro-dark">【微波凡鐵禁忌，切勿挑戰科律】</h4>
                      </div>
                      <p className="text-xs md:text-sm font-bold text-retro-dark/85">
                        嚴禁攜帶任何金屬製品挑戰微波爐之狂雷。微波金屬將引發雷火相引，此為凡胎科學物理之不變天律，絕非仙道魔法。炸毀洞府者理應索償無門。
                      </p>
                    </div>

                    {/* Item 4 */}
                    <div className="bg-retro-cream/20 border-[2.5px] border-retro-dark p-4 rounded-2xl shadow-[4px_4px_0px_rgba(28,44,66,0.06)]">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="bg-retro-dark text-retro-cream text-[10px] px-2 py-0.5 rounded border border-retro-dark font-black tracking-wider">
                          條款四
                        </span>
                        <h4 className="font-serif font-black text-sm text-retro-dark">【紅塵遊戲戲言，切莫作真博弈】</h4>
                      </div>
                      <p className="text-xs md:text-sm font-bold text-retro-dark/85">
                        本大殿對話提供之修行或生活指南均為玩樂仙術。切勿據此進行股市作戰、凡間投機博弈或重大人生轉折，理性看待，止於智者。
                      </p>
                    </div>
                  </div>
                </div>

                {/* Acceptance Checkbox */}
                <label className="flex items-start gap-3.5 p-4 bg-retro-cream border-2 border-dashed border-retro-dark rounded-2xl cursor-pointer hover:bg-retro-cream/70 transition-colors select-none">
                  <input
                    type="checkbox"
                    checked={isDisclaimerChecked}
                    onChange={(e) => setIsDisclaimerChecked(e.target.checked)}
                    className="w-5.5 h-5.5 accent-retro-vermilion border-2 border-retro-dark rounded cursor-pointer shrink-0 mt-0.5"
                    id="checkbox-accept-treaty"
                  />
                  <div className="text-xs md:text-sm font-bold leading-normal">
                    <span className="text-retro-vermilion font-serif font-black block text-sm mb-1">
                      ⚠️ 印鑑自覺與道心擔保：
                    </span>
                    貧道已深知以上條款。保證本人道心無比堅定、耐熱耐罵。若因不信邪而招致脾臟受損或炸毀微波爐，一概自負後果，絕不賴皮！
                  </div>
                </label>
              </div>

              {/* Action Buttons Footer */}
              <div className="bg-retro-cream px-6 py-5 border-t-[3.5px] border-retro-dark flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 shrink-0 select-none">
                <span className="text-[10px] text-retro-dark/50 font-mono text-left max-w-xs leading-tight hidden sm:block">
                  SIGNING THIS DECREE WILL PERSISTENTLY RECORD YOUR AGREEMENT METADATA ON THIS COMPUTER.
                </span>
                
                <div className="flex flex-col sm:flex-row gap-3 items-stretch justify-end">
                  <button
                    type="button"
                    onClick={handleRejectDisclaimer}
                    className="px-5 py-3 rounded-full border-[3px] border-retro-dark text-xs md:text-sm font-serif font-black bg-retro-white text-retro-dark hover:bg-retro-cream hover:text-retro-vermilion cursor-pointer shadow-[3.5px_3.5px_0px_#1C2C42] active:translate-y-0.5 active:shadow-none transition-all flex items-center justify-center gap-1.5"
                    id="btn-reject-treaty"
                  >
                    <span>🏃‍♂️ 道心不穩，退殿避難</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleAcceptDisclaimer}
                    disabled={!isDisclaimerChecked}
                    className={`px-6 py-3.5 rounded-full border-[3px] border-retro-dark text-xs md:text-sm font-serif font-black flex items-center justify-center gap-1.5 cursor-pointer shadow-[3.5px_3.5px_0px_#1C2C42] active:translate-y-0.5 active:shadow-none transition-all ${
                      isDisclaimerChecked
                        ? "bg-retro-vermilion text-retro-white hover:bg-retro-vermilion-hover"
                        : "bg-gray-200 text-gray-400 border-gray-300 shadow-none cursor-not-allowed transform-none active:translate-y-0"
                    }`}
                    id="btn-confirm-treaty"
                  >
                    <span>✍️ 貧道心智堅定，簽認印信！</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Playful Decorative Clouds */}
      <div className="absolute top-12 left-10 opacity-70 pointer-events-none z-0 floating-cloud-1 hidden lg:block">
        <svg width="150" height="75" viewBox="0 0 120 60" fill="none">
          <path d="M20 40 C20 30, 40 25, 45 35 C50 15, 75 10, 80 25 C90 15, 105 20, 105 35 C112 35, 115 43, 105 47 L15 47 C5 43, 10 35, 20 40 Z" fill="#FCFBF7" stroke="#1C2C42" strokeWidth="3" />
        </svg>
      </div>
      <div className="absolute top-28 right-16 opacity-70 pointer-events-none z-0 floating-cloud-2 hidden lg:block">
        <svg width="190" height="95" viewBox="0 0 120 60" fill="none">
          <path d="M20 40 C20 30, 40 25, 45 35 C50 15, 75 10, 80 25 C90 15, 105 20, 105 35 C112 35, 115 43, 105 47 L15 47 C5 43, 10 35, 20 40 Z" fill="#FCFBF7" stroke="#1C2C42" strokeWidth="3" />
          <path d="M30 43 Q50 46 70 43" stroke="#1C2C42" strokeWidth="1" strokeLinecap="round" />
        </svg>
      </div>

      {/* Retro Red Woodblock Sun */}
      <div className="absolute -top-10 -right-10 w-36 h-36 rounded-full border-[4px] border-retro-dark bg-[#D94E41] opacity-75 z-0 hidden sm:block pointer-events-none">
        <div className="absolute inset-3 border-2 border-dashed border-retro-cream rounded-full"></div>
      </div>

      {/* Signboard Header */}
      <header className="w-full max-w-7xl mx-auto px-6 py-6 flex flex-col md:flex-row items-center justify-between z-10 relative gap-6">
        <div className="flex items-center gap-4 bg-retro-white border-[4px] border-retro-dark rounded-full px-7 py-3 shadow-[5px_5px_0px_#1C2C42]">
          <div className="w-12 h-12 rounded-full border-2 border-retro-dark flex items-center justify-center bg-retro-vermilion shadow-inner relative shrink-0">
            <span className="text-retro-cream font-serif font-black text-xl select-none leading-none pt-0.5">吉</span>
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-serif font-black text-retro-dark tracking-widest leading-none">
              宸極木堂 · 雲伺大殿
            </h1>
            <p className="text-[11px] md:text-xs text-retro-dark/75 font-mono tracking-wider mt-1.5 font-extrabold uppercase">
              TIANLI CLOUD CHATBOT & FIRESTORE PANE
            </p>
          </div>
        </div>

        {/* Dynamic Multi-module Tab Switchers */}
        <div className="flex flex-wrap justify-center bg-retro-white border-[3.5px] border-retro-dark rounded-3xl md:rounded-full p-1.5 shadow-[4px_4px_0px_#1C2C42] z-20 gap-1 md:gap-0">
          <button
            onClick={() => setActiveTab("chat")}
            className={`px-5 py-2.5 rounded-full text-xs md:text-sm font-black transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === "chat" 
                ? "bg-retro-vermilion text-retro-cream border-2 border-retro-dark shadow-[1.5px_1.5px_0px_#1C2C42]" 
                : "text-retro-dark/75 hover:text-retro-dark hover:bg-retro-cream/20"
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span>智能客服大殿</span>
          </button>
          
          <button
            onClick={() => setActiveTab("test")}
            className={`px-5 py-2.5 rounded-full text-xs md:text-sm font-black transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === "test" 
                ? "bg-retro-gold text-retro-dark border-2 border-retro-dark shadow-[1.5px_1.5px_0px_#1C2C42]" 
                : "text-retro-dark/75 hover:text-retro-dark hover:bg-retro-cream/20"
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>神木留心板 (Firestore)</span>
          </button>

          <button
            onClick={() => setActiveTab("account")}
            className={`px-5 py-2.5 rounded-full text-xs md:text-sm font-black transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === "account" 
                ? "bg-retro-sage text-retro-cream border-2 border-retro-dark shadow-[1.5px_1.5px_0px_#1C2C42]" 
                : "text-retro-dark/75 hover:text-retro-dark hover:bg-retro-cream/20"
            }`}
          >
            <UserIcon className="w-4 h-4" />
            <span>造冊契印</span>
          </button>
        </div>
      </header>

      {/* Main Container Stage */}
      <main className="flex-grow flex flex-col items-center justify-center px-4 py-8 md:py-12 z-10 w-full max-w-7xl mx-auto relative gap-8">
        
        {/* Global Action Banner Info */}
        {feedbackAlert && activeTab !== "account" && (
          <div className="w-full max-w-5xl md:max-w-6xl" id="feedback-alert">
            <div className={`p-5 rounded-3xl border-[4px] border-retro-dark shadow-[5px_5px_0px_#1C2C42] ${
              feedbackAlert.type === "error" 
                ? "bg-[#FFEBE9] text-retro-vermilion" 
                : "bg-[#EAFDF7] text-retro-sage"
            }`}>
              <div className="flex items-start gap-4">
                {feedbackAlert.type === "error" ? (
                  <AlertTriangle className="w-6 h-6 text-retro-vermilion shrink-0 mt-0.5" />
                ) : (
                  <CheckCircle className="w-6 h-6 text-retro-sage shrink-0 mt-0.5" />
                )}
                <div>
                  <h4 className="font-black text-base md:text-lg tracking-wide text-retro-dark">{feedbackAlert.title}</h4>
                  <p className="text-sm mt-1.5 leading-relaxed font-bold">{feedbackAlert.message}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {authLoading ? (
          // Rotating central stamp loading indicator
          <div className="flex flex-col items-center justify-center space-y-6 py-24">
            <motion.div 
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
              className="w-20 h-20 border-[4.5px] border-retro-dark border-t-retro-vermilion rounded-full flex items-center justify-center bg-retro-white shadow-[5px_5px_0px_rgba(0,0,0,0.1.5)]"
            >
              <span className="text-retro-dark text-2xl font-black font-serif">契</span>
            </motion.div>
            <p className="text-retro-dark font-serif font-black tracking-widest text-base md:text-lg animate-pulse">
              正在勾連雲中樞，請稍候...
            </p>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            
            {/* === MODULE 1: CUSTOMER SUPPORT CHATBOT (智能客服大殿) === */}
            {activeTab === "chat" && (
              <motion.div
                key="module-chat"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.2 }}
                className="w-full max-w-5xl md:max-w-6xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch"
              >
                {/* Left Side: Avatar & Smart instruction board */}
                <div className="lg:col-span-4 hand-drawn-card p-6 flex flex-col items-stretch text-center bg-retro-white gap-6 shadow-md overflow-y-auto h-[580px] md:h-[650px]" id="chat-rooms-sidebar">
                  {/* Mascot and Title */}
                  <div className="flex flex-col items-center gap-2 select-none">
                    {renderMascot()}
                  </div>

                  {/* Feature: Chat Rooms Section */}
                  <div className="border-t-2 border-retro-dark border-dashed pt-4 flex flex-col items-stretch text-left w-full">
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-xs md:text-sm font-black font-serif text-retro-dark flex items-center gap-1.5 select-none animate-pulse">
                        🔮 洞天仙閣 (Chat Rooms)
                        <span className="bg-retro-gold text-retro-dark text-[10px] px-1.5 py-0.5 rounded-md border border-retro-dark font-mono font-black shadow-[1px_1px_0px_#1C2C42]">
                          {chatRooms.length}/10
                        </span>
                      </span>
                    </div>

                    {/* Chatroom manual creation form */}
                    <div className="flex gap-1.5 mb-4">
                      <input
                        type="text"
                        value={customRoomName}
                        onChange={(e) => setCustomRoomName(e.target.value)}
                        placeholder="新增自訂洞天名稱..."
                        maxLength={20}
                        className="flex-grow hand-drawn-input text-xs px-2.5 py-1.5 shadow-inner bg-retro-cream/20 text-retro-dark font-bold font-sans"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleCreateRoom(customRoomName);
                            setCustomRoomName("");
                          }
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          handleCreateRoom(customRoomName);
                          setCustomRoomName("");
                        }}
                        disabled={chatRooms.length >= 10}
                        className="bg-retro-gold hover:bg-retro-gold/75 disabled:opacity-50 border-2 border-retro-dark p-1.5 rounded-lg text-xs font-black cursor-pointer shadow-[1px_1px_0px_#1C2C42] active:translate-y-0.5 active:shadow-none transition-all flex items-center justify-center"
                        title="闢立新聊天室"
                      >
                        <Plus className="w-4 h-4 text-retro-dark" />
                      </button>
                    </div>

                    {/* Chat Rooms Scrollable List */}
                    <div className="space-y-1.5 max-h-[140px] md:max-h-[180px] overflow-y-auto pr-1">
                      {chatRooms.map((room) => {
                        const isActive = room.id === activeRoomId;
                        return (
                          <div
                            key={room.id}
                            onClick={() => {
                              setActiveRoomId(room.id);
                              const activeKey = `covenant_active_room_${sessionToken}`;
                              localStorage.setItem(activeKey, room.id);
                            }}
                            className={`group flex justify-between items-center px-2.5 py-1.5 rounded-xl text-xs font-serif font-black border-2 cursor-pointer transition-all ${
                              isActive 
                                ? "bg-retro-gold text-retro-dark border-retro-dark shadow-[1.5px_1.5px_0px_#1C2C42]"
                                : "bg-retro-cream/30 hover:bg-retro-cream text-retro-dark/80 border-retro-dark/40 hover:border-retro-dark"
                            }`}
                          >
                            <span className="truncate max-w-[85%] pr-1">{room.name}</span>
                            <button
                              type="button"
                              onClick={(e) => handleDeleteRoom(room.id, e)}
                              className="text-retro-vermilion hover:scale-110 active:scale-95 transition-all p-0.5 rounded opacity-60 group-hover:opacity-100"
                              title="抹去此洞天"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  
                  {/* Strategy & Guide details */}
                  <div className="border-t-2 border-retro-dark border-dashed pt-4 w-full">
                    <p className="text-xs md:text-sm font-bold text-retro-dark/80 text-left leading-relaxed">
                      📜 <b className="text-retro-vermilion font-serif font-black text-sm md:text-base">【靈鳥「吉」漫談說明書暨免責聲明】</b><br/>
                      <span className="text-[11px] text-retro-vermilion block mt-1 font-serif">【無話題設限】本殿靈鳥已開通真人般「多重短句、連續彈幕」式聊天仙術！您可以和「吉」隨意閒聊（無主題限制），他會用極致毒舌、黑色幽默與您對線。仙友自負道心破碎、被氣到破防等一切風險！</span>
                    </p>
                    <div className="mt-3.5 flex flex-wrap gap-1.5 justify-start">
                      {["和吉嘮嘮嗑", "求毒舌拷問", "講個地獄笑話", "你有八卦嗎", "隨心暢聊吧", "關於神獸吉"].map((keyword) => (
                        <button
                          type="button"
                          key={keyword}
                          onClick={() => setChatInput(keyword)}
                          className="bg-retro-cream hover:bg-retro-gold/35 border-2 border-retro-dark px-2.5 py-1 rounded-lg text-xs font-black cursor-pointer shadow-[1px_1px_0px_#1C2C42] active:translate-y-0.5 active:shadow-none transition-all"
                        >
                          {keyword}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="text-[10px] text-retro-dark/40 font-mono tracking-wider text-left w-full border-t border-retro-dark/10 pt-3 mt-auto select-none">
                    SESSION TOKEN IS STORED LOCALLY IN BROWSER STORAGE.
                  </div>
                </div>

                {/* Right Side: Chatbox Area with Scroll Log & Message entry */}
                <div className="lg:col-span-8 hand-drawn-card flex flex-col justify-between overflow-hidden bg-retro-white h-[580px] md:h-[650px] shadow-md" id="chat-scroller-layout">
                  {/* Tab header stamp */}
                  <div className="bg-retro-cream/50 px-6 py-4.5 border-b-[4px] border-retro-dark flex justify-between items-center">
                    <div className="flex items-center gap-2.5">
                      <span className="w-3" />
                      <span className="w-3 h-3 bg-retro-sage rounded-full animate-ping shrink-0" />
                      <span className="text-sm md:text-base font-serif font-black tracking-widest">主殿大門接待處 (Real-time Console)</span>
                    </div>
                    <span className="text-xs font-mono text-retro-dark/85 font-black uppercase tracking-wider">
                      Firestore Session Feed
                    </span>
                  </div>

                  {/* Search Bar for filtering chat logs */}
                  <div className="px-5 py-3.5 bg-retro-cream/35 border-b-[4px] border-retro-dark flex flex-col md:flex-row md:items-center gap-3 shrink-0">
                    <div className="relative flex-grow">
                      <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-retro-dark/50">
                        <Search className="w-4 h-4" />
                      </span>
                      <input
                        type="text"
                        value={searchText}
                        onChange={(e) => setSearchText(e.target.value)}
                        placeholder="搜尋舊有聊天記錄關鍵字..."
                        className="w-full bg-retro-white border-[3px] border-retro-dark rounded-xl py-2 pl-10 pr-9 text-xs md:text-sm font-sans font-bold focus:outline-none focus:ring-0 shadow-[2px_2px_0px_#1C2C42] placeholder-retro-dark/40"
                      />
                      {searchText && (
                        <button
                          type="button"
                          onClick={() => setSearchText("")}
                          className="absolute inset-y-0 right-0 flex items-center pr-3 text-retro-dark/50 hover:text-retro-dark cursor-pointer"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    <div className="flex items-center justify-between md:justify-end gap-2 shrink-0">
                      <span className="text-xs font-serif font-black text-retro-dark/65 bg-retro-white px-2.5 py-1.5 rounded-lg border-2 border-retro-dark shadow-[1.5px_1.5px_0px_#1C2C42] select-none">
                        總共: <b className="text-retro-dark">{chatLogs.length}</b> 條
                      </span>
                      {searchText && (
                        <span className="text-xs font-serif font-black text-retro-cream bg-retro-vermilion px-2.5 py-1.5 rounded-lg border-2 border-retro-dark shadow-[1.5px_1.5px_0px_#1C2C42] select-none">
                          符合: <b>{filteredChatLogs.length}</b> 條
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Messaging records display panel */}
                  <div className="flex-grow p-5 md:p-6 overflow-y-auto space-y-5 bg-retro-white max-h-[440px] md:max-h-[500px]">
                    {chatLogs.length === 0 ? (
                      <div className="flex flex-col items-center justify-center text-center py-24 space-y-4">
                        <div className="p-4 bg-retro-cream rounded-full border-2 border-dashed border-retro-dark font-serif text-retro-dark/75 text-base shadow-sm">
                          📭 符紙淨空
                        </div>
                        <p className="text-sm md:text-base text-retro-dark/85 font-black font-serif leading-relaxed max-w-md">
                          當前聊天紀錄此時無聲，您可以試著在下方輸入「你好」或隨意發送訊息，啟動對話！
                        </p>
                      </div>
                    ) : filteredChatLogs.length === 0 ? (
                      <div className="flex flex-col items-center justify-center text-center py-16 space-y-4">
                        <div className="p-4 bg-retro-cream rounded-full border-2 border-dashed border-retro-dark font-serif text-retro-dark/75 text-base shadow-sm">
                          🔍 查無玄機
                        </div>
                        <p className="text-sm text-retro-dark/85 font-black font-serif leading-relaxed max-w-md">
                          於舊有聊天記錄中找不到包含「<span className="text-retro-vermilion">{searchText}</span>」的訊息。
                        </p>
                        <button
                          type="button"
                          onClick={() => setSearchText("")}
                          className="bg-retro-cream hover:bg-retro-cream/80 border-[3px] border-retro-dark px-4 py-2 rounded-xl text-xs font-black scroll-smooth cursor-pointer font-serif shadow-[3px_3px_0px_#1C2C42] active:translate-y-0.5 active:shadow-none transition-all"
                        >
                          重設搜尋篩選
                        </button>
                      </div>
                    ) : (
                      filteredChatLogs.map((log) => {
                        const isBot = log.sender === "bot";
                        return (
                          <motion.div
                            key={log.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className={`flex items-start gap-4 ${isBot ? "justify-start" : "justify-end"}`}
                          >
                            {isBot && (
                              <div className="w-10 h-10 rounded-full border-2 border-retro-dark bg-retro-gold flex items-center justify-center font-serif text-base font-black shrink-0 shadow-[2px_2px_0px_#1C2C42]">
                                吉
                              </div>
                            )}
                            
                            <div className="flex flex-col max-w-[80%]">
                              <div className={`p-4 rounded-2xl text-sm md:text-base font-bold leading-relaxed border-[3px] border-retro-dark shadow-[3px_3px_0px_#1C2C42] ${
                                isBot 
                                  ? "bg-retro-cream text-retro-dark rounded-tl-none" 
                                  : "bg-retro-vermilion text-retro-cream rounded-tr-none"
                              }`}>
                                <p className="whitespace-pre-wrap">{log.message}</p>
                              </div>
                              <span className={`text-[10px] text-retro-dark/45 font-mono mt-1.5 ${isBot ? "text-left pl-1" : "text-right pr-1"}`}>
                                {log.timestamp ? new Date(log.timestamp.seconds * 1000).toLocaleTimeString("zh-TW", { hour: '2-digit', minute: '2-digit' }) : "傳遞中..."}
                              </span>
                            </div>

                            {!isBot && (
                              <div className="w-10 h-10 rounded-full border-2 border-retro-dark bg-retro-sage text-retro-cream flex items-center justify-center font-serif text-base font-black shrink-0 shadow-[2px_2px_0px_#1C2C42]">
                                {currentUser?.displayName ? currentUser.displayName.slice(0, 1) : "友"}
                              </div>
                            )}
                          </motion.div>
                        );
                      })
                    )}
                    <div ref={chatScrollRef} />
                  </div>

                  {/* Typing input bar */}
                  <form onSubmit={handleSendChatMessage} className="p-4 md:p-5 bg-retro-cream/40 border-t-[4px] border-retro-dark flex gap-3 shrink-0">
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="與守護鳥吉智能客服攀談... (如輸入：資料庫)"
                      className="flex-grow hand-drawn-input text-sm md:text-base px-4 py-3 shadow-inner"
                      id="chat-input"
                    />
                    <button
                      type="submit"
                      className="hand-drawn-button-primary px-6 py-3 inline-flex items-center gap-2 text-sm md:text-base font-black select-none cursor-pointer"
                      id="chat-send-btn"
                    >
                      <Send className="w-4 h-4" />
                      <span>傳送 (Send)</span>
                    </button>
                  </form>
                </div>
              </motion.div>
            )}

            {/* === MODULE 2: FIRESTORE TEST PORTAL (神木留心板) === */}
            {activeTab === "test" && (
              <motion.div
                key="module-test"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.2 }}
                className="w-full max-w-5xl md:max-w-6xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch"
              >
                {/* Left Form: Field input, Submit, Clear and Refill buttons */}
                <div className="lg:col-span-5 hand-drawn-card p-8 md:p-10 bg-retro-white flex flex-col justify-between shadow-md">
                  <form onSubmit={handleFeedbackSubmit} className="space-y-6">
                    <div className="border-b-2 border-retro-dark border-dashed pb-4">
                      <div className="inline-block bg-retro-gold text-retro-dark border-2 border-retro-dark px-3.5 py-1 rounded-full text-xs font-black stamp-badge">
                        TEST PANEL
                      </div>
                      <h3 className="text-2xl md:text-3xl font-serif font-black tracking-widest text-retro-dark mt-2.5">
                        神木留心板
                      </h3>
                      <p className="text-xs md:text-sm text-retro-dark/75 tracking-wider font-extrabold mt-1.5">
                        INPUT TEST TEXT SAVING DIRECTLY TO FIRESTORE
                      </p>
                    </div>

                    <div className="space-y-3.5">
                      <label htmlFor="test-content" className="block text-sm md:text-base font-extrabold text-retro-dark">
                        ✍ 留言墨韻內文 (Test Input Content)：
                      </label>
                      <textarea
                        id="test-content"
                        rows={5}
                        value={testInput}
                        onChange={(e) => setTestInput(e.target.value)}
                        placeholder="請在這裡書寫您想傳送至 Firestore 資料庫的測試文字。例如：『太古陣法， Firestore 法力成功導入！大吉！』"
                        className="w-full hand-drawn-input text-sm md:text-base px-4 py-3.5 resize-none shadow-inner"
                        required
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-3">
                      {/* CLEAR / REFILL BUTTON (清除重填) */}
                      <button
                        type="button"
                        onClick={handleFeedbackClear}
                        className="hand-drawn-button-secondary py-3 text-sm md:text-base font-black text-center flex items-center justify-center gap-2 cursor-pointer"
                        id="clear-form-btn"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span>清除重填</span>
                      </button>

                      {/* SUBMIT BUTTON (送出) */}
                      <button
                        type="submit"
                        disabled={actionLoading}
                        className="hand-drawn-button-primary py-3 text-sm md:text-base font-black text-center flex items-center justify-center gap-2 cursor-pointer"
                        id="submit-form-btn"
                      >
                        <Send className="w-4 h-4 select-none" />
                        <span>確認送出</span>
                      </button>
                    </div>
                  </form>

                  <div className="border-t-[2.5px] border-retro-dark border-dashed pt-5 mt-8">
                    <div className="flex gap-3 items-start">
                      <HelpCircle className="w-5 h-5 text-retro-vermilion shrink-0 mt-0.5" />
                      <p className="text-xs md:text-sm font-semibold text-retro-dark/75 leading-relaxed">
                        當您點擊「確認送出」後，本網頁會將文字包裝成 Feedback 實體，即時寫入您的 Firebase Firestore。
                        安全性规则已配置為全寬容，保證任何人能無障礙讀取和儲存數據！
                      </p>
                    </div>
                  </div>
                </div>

                {/* Right Scroll List: Real-time update records from Firestore */}
                <div className="lg:col-span-7 hand-drawn-card bg-retro-white flex flex-col justify-between overflow-hidden h-[580px] md:h-[650px] shadow-md">
                  <div className="bg-retro-cream p-5 border-b-[4px] border-retro-dark flex justify-between items-center shrink-0">
                    <div className="flex items-center gap-2.5">
                      <Clock className="w-5 h-5 text-retro-dark" />
                      <span className="text-sm md:text-base font-serif font-black tracking-widest animate-pulse">雲端即時留言石碑 (Realtime Logs)</span>
                    </div>
                    <span className="bg-retro-dark text-retro-cream text-xs font-mono font-black px-3 py-1 rounded-full">
                      Firestore Active
                    </span>
                  </div>

                  <div className="flex-grow p-5 md:p-6 overflow-y-auto space-y-4">
                    {feedbacks.length === 0 ? (
                      <div className="flex flex-col items-center justify-center text-center py-36 space-y-3">
                        <span className="text-4xl">🏜</span>
                        <p className="text-sm md:text-base font-black text-retro-dark/65 font-serif">
                          石碑之上尚無刻印。趕快在左側提筆寫入留言吧！
                        </p>
                      </div>
                    ) : (
                      feedbacks.map((item) => (
                        <motion.div
                          key={item.id}
                          initial={{ opacity: 0, x: 10 }}
                          animate={{ opacity: 1, x: 0 }}
                          className="bg-retro-cream/30 p-4 border-2 border-retro-dark rounded-2xl shadow-[3px_3px_0px_#1C2C42] hover:bg-retro-cream/50 transition-colors"
                        >
                          <div className="flex justify-between items-center mb-2.5 border-b border-retro-dark/15 pb-1.5 align-middle">
                            <span className="text-xs md:text-sm font-serif font-black text-retro-vermilion inline-flex items-center gap-1.5">
                              👤 留筆者：{item.authorName}
                            </span>
                            <span className="text-[10px] md:text-xs text-retro-dark/60 font-mono">
                              {item.createdAt ? new Date(item.createdAt.seconds * 1000).toLocaleString() : "剛才"}
                            </span>
                          </div>
                          <p className="text-sm md:text-base font-bold text-retro-dark leading-relaxed break-words whitespace-pre-wrap">
                            {item.content}
                          </p>
                          <div className="mt-1.5 flex justify-end">
                            <span className="text-[10px] text-retro-dark/45 font-mono">
                              ID: {item.id}
                            </span>
                          </div>
                        </motion.div>
                      ))
                    )}
                  </div>

                  <div className="bg-retro-cream px-5 py-4 text-center border-t-2 border-retro-dark border-dashed shrink-0">
                    <p className="text-xs md:text-sm font-serif text-retro-dark/70 font-black tracking-widest">
                      只呈現當前最新 15 則契文記錄，太古法術自動控容
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            {/* === MODULE 3: AUTHENTICATION ROSTER (造冊登錄會員) === */}
            {activeTab === "account" && (
              <div className="w-full max-w-[580px] hand-drawn-card flex flex-col overflow-hidden relative shadow-lg">
                <div className="p-9 md:p-12 bg-retro-white">
                  {currentUser ? (
                    // User already logged in view
                    <div className="space-y-8">
                      <div className="text-center">
                        <div className="w-24 h-24 rounded-full border-[3.5px] border-retro-dark mx-auto p-0.5 bg-retro-cream flex items-center justify-center overflow-hidden shadow-[3px_3px_0px_#1C2C42]">
                          {currentUser.photoURL ? (
                            <img src={currentUser.photoURL} className="w-full h-full rounded-full object-cover" alt="尊容" referrerPolicy="no-referrer" />
                          ) : (
                            <div className="w-full h-full bg-retro-sage text-retro-cream flex items-center justify-center text-3xl font-serif font-black">
                              {currentUser.displayName ? currentUser.displayName.slice(0, 1) : "神"}
                            </div>
                          )}
                        </div>
                        <h3 className="text-xl md:text-2xl font-serif font-black text-retro-dark mt-4 tracking-widest">
                          {currentUser.displayName || "匿名大仙"}
                        </h3>
                        <p className="text-sm md:text-base font-mono text-retro-dark/70 mt-1 font-bold select-all">{currentUser.email}</p>
                      </div>

                      <div className="border-[3.5px] border-retro-dark bg-retro-white rounded-2xl overflow-hidden divide-y-[3px] divide-retro-dark text-sm md:text-base">
                        <div className="p-4 px-5 bg-retro-cream/30 flex justify-between font-extrabold">
                          <span className="text-retro-dark/65">尊屬會籍</span>
                          <span className="font-serif text-retro-vermilion">宸極行者</span>
                        </div>
                        <div className="p-4 px-5 flex justify-between font-extrabold">
                          <span className="text-retro-dark/65">信符狀態</span>
                          <span>
                            {currentUser.emailVerified ? (
                              <span className="text-retro-sage font-black inline-flex items-center gap-1">
                                <ShieldCheck className="w-4.5 h-4.5" />
                                <span>認證安穩</span>
                              </span>
                            ) : (
                              <span className="text-retro-vermilion font-black inline-flex items-center gap-1 animate-pulse">
                                <AlertTriangle className="w-4.5 h-4.5" />
                                <span>尚未認證</span>
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="p-4 px-5 bg-retro-cream/30 flex justify-between font-extrabold">
                          <span className="text-retro-dark/65">登錄渠道</span>
                          <span className="font-mono">
                            {currentUser.providerData[0]?.providerId === "google.com" ? "Google 快捷" : "信件契印"}
                          </span>
                        </div>
                      </div>

                      {/* Not verified warns */}
                      {!currentUser.emailVerified && (
                        <div className="border-[4px] border-retro-dark bg-[#FFF3CD] p-5 rounded-2xl space-y-4 shadow-[4px_4px_0px_#1C2C42]">
                          <p className="text-xs md:text-sm font-black text-retro-dark leading-relaxed">
                            ⚠️ 您的電子信箱尚未圓滿驗證！您可以手動刷新伺服器狀態或重新發送驗證契文。
                          </p>
                          <div className="flex gap-3">
                            <button
                              onClick={handleRefreshVerificationStatus}
                              disabled={refreshing}
                              className="hand-drawn-button-secondary px-4 py-2.5 text-xs md:text-sm font-black flex-grow flex items-center justify-center gap-2 cursor-pointer"
                              id="act-refresh-verify"
                            >
                              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
                              <span>刷新認證</span>
                            </button>
                            <button
                              onClick={handleResendVerification}
                              disabled={actionLoading}
                              className="hand-drawn-button-primary px-4 py-2.5 text-xs md:text-sm font-black flex-grow flex items-center justify-center gap-2 cursor-pointer"
                              id="act-resend-verify"
                            >
                              <Send className="w-4 h-4" />
                              <span>重發驗證信</span>
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="flex justify-end pt-3">
                        <button
                          onClick={handleSignOut}
                          className="hand-drawn-button-primary px-6 py-3 text-sm md:text-base font-black flex items-center gap-2 cursor-pointer"
                          id="act-logout"
                        >
                          <LogOut className="w-4 h-4" />
                          <span>退殿退出</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    // Authentication input switcher (Login, Register, Forgot Password)
                    <div>
                      <div className="text-center mb-6">
                        <h2 className="text-3xl md:text-4xl font-serif font-black tracking-widest text-retro-vermilion">
                          {authMode === "login" && "大殿核印"}
                          {authMode === "register" && "締約造冊"}
                          {authMode === "forgot" && "尋取印結"}
                        </h2>
                        <p className="text-xs md:text-sm text-retro-dark/75 font-serif font-black uppercase tracking-widest mt-1.5">
                          {authMode === "login" && "SIGN IN GATEWAY"}
                          {authMode === "register" && "SIGN UP LEDGER"}
                          {authMode === "forgot" && "RECOVER PASSWORD PIN"}
                        </p>
                      </div>

                      {feedbackAlert && (
                        <div className={`mb-5 p-4 rounded-xl border-[3px] border-retro-dark ${
                          feedbackAlert.type === "error" ? "bg-[#FFEBE9] text-retro-vermilion" : "bg-[#EAFDF7] text-retro-sage"
                        }`}>
                          <p className="text-xs md:text-sm font-bold leading-relaxed">{feedbackAlert.message}</p>
                        </div>
                      )}

                      <AnimatePresence mode="wait">
                        {authMode === "login" && (
                          <motion.div
                            key="login-form-view"
                            initial={{ opacity: 0, y: 5 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="space-y-5"
                          >
                            <button
                              onClick={handleGoogleAuth}
                              disabled={actionLoading}
                              className="w-full hand-drawn-button-secondary py-3 flex items-center justify-center gap-3.5 cursor-pointer text-sm md:text-base font-black shadow-sm"
                              id="login-google-btn"
                            >
                              <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none">
                                <path fillRule="evenodd" clipRule="evenodd" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                                <path fillRule="evenodd" clipRule="evenodd" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                                <path fillRule="evenodd" clipRule="evenodd" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.85z" fill="#FBBC05"/>
                                <path fillRule="evenodd" clipRule="evenodd" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.85c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                              </svg>
                              <span>Google 一鍵快速登入</span>
                            </button>

                            <div className="relative py-2">
                              <div className="absolute inset-0 flex items-center">
                                <div className="w-full border-t-[2.5px] border-retro-dark border-dashed"></div>
                              </div>
                              <div className="relative flex justify-center text-xs">
                                <span className="bg-retro-white px-3 font-black text-retro-dark/65 uppercase tracking-widest">
                                  或信箱傳統扣關
                                </span>
                              </div>
                            </div>

                            <form onSubmit={handleEmailSignIn} className="space-y-4">
                              <div className="relative">
                                <Mail className="w-5 h-5 text-retro-dark/45 absolute left-3.5 top-1/2 transform -translate-y-1/2" />
                                <input
                                  type="email"
                                  value={email}
                                  onChange={(e) => setEmail(e.target.value)}
                                  placeholder="電子郵件信箱"
                                  className="w-full hand-drawn-input pl-11 py-3 text-sm md:text-base shadow-inner"
                                  required
                                />
                              </div>

                              <div className="relative">
                                <Lock className="w-5 h-5 text-retro-dark/45 absolute left-3.5 top-1/2 transform -translate-y-1/2" />
                                <input
                                  type={showPassword ? "text" : "password"}
                                  value={password}
                                  onChange={(e) => setPassword(e.target.value)}
                                  placeholder="契盟保護密碼"
                                  className="w-full hand-drawn-input pl-11 pr-11 py-3 text-sm md:text-base shadow-inner"
                                  required
                                />
                                <button
                                  type="button"
                                  onClick={() => setShowPassword(!showPassword)}
                                  className="absolute right-3.5 top-1/2 transform -translate-y-1/2 text-retro-dark/60 hover:text-retro-dark cursor-pointer p-1"
                                >
                                  {showPassword ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
                                </button>
                              </div>

                              <button
                                type="submit"
                                disabled={actionLoading}
                                className="w-full hand-drawn-button-primary py-3.5 text-sm md:text-base font-black flex items-center justify-center gap-2 cursor-pointer"
                                id="login-act-btn"
                              >
                                <LogIn className="w-4.5 h-4.5" />
                                <span>核印登入大殿</span>
                              </button>
                            </form>

                            <div className="flex justify-between items-center text-xs md:text-sm font-serif font-black pt-2">
                              <button
                                onClick={() => setAuthMode("register")}
                                className="text-retro-vermilion hover:underline font-black cursor-pointer"
                              >
                                註冊新帳籍 →
                              </button>
                              <button
                                onClick={() => setAuthMode("forgot")}
                                className="text-retro-dark/65 hover:text-retro-dark cursor-pointer font-sans"
                              >
                                忘記密碼？
                              </button>
                            </div>
                          </motion.div>
                        )}

                        {authMode === "register" && (
                          <motion.div
                            key="register-form-view"
                            initial={{ opacity: 0, y: 5 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="space-y-5"
                          >
                            <form onSubmit={handleEmailSignUp} className="space-y-4">
                              <div className="relative">
                                <UserIcon className="w-5 h-5 text-retro-dark/45 absolute left-3.5 top-1/2 transform -translate-y-1/2" />
                                <input
                                  type="text"
                                  value={displayName}
                                  onChange={(e) => setDisplayName(e.target.value)}
                                  placeholder="仙友尊號 (例如: 桃花上仙)"
                                  className="w-full hand-drawn-input pl-11 py-3 text-sm md:text-base shadow-inner"
                                  required
                                />
                              </div>

                              <div className="relative">
                                <Mail className="w-5 h-5 text-retro-dark/45 absolute left-3.5 top-1/2 transform -translate-y-1/2" />
                                <input
                                  type="email"
                                  value={email}
                                  onChange={(e) => setEmail(e.target.value)}
                                  placeholder="電子郵件地址"
                                  className="w-full hand-drawn-input pl-11 py-3 text-sm md:text-base shadow-inner"
                                  required
                                />
                              </div>

                              <div className="relative">
                                <Lock className="w-5 h-5 text-retro-dark/45 absolute left-3.5 top-1/2 transform -translate-y-1/2" />
                                <input
                                  type={showPassword ? "text" : "password"}
                                  value={password}
                                  onChange={(e) => setPassword(e.target.value)}
                                  placeholder="設定登入密碼 (6位數以上)"
                                  className="w-full hand-drawn-input pl-11 py-3 text-sm md:text-base shadow-inner"
                                  required
                                />
                              </div>

                              <div className="relative">
                                <Lock className="w-5 h-5 text-retro-dark/45 absolute left-3.5 top-1/2 transform -translate-y-1/2" />
                                <input
                                  type={showConfirmPassword ? "text" : "password"}
                                  value={confirmPassword}
                                  onChange={(e) => setConfirmPassword(e.target.value)}
                                  placeholder="確認設定密碼"
                                  className="w-full hand-drawn-input pl-11 py-3 text-sm md:text-base shadow-inner"
                                  required
                                />
                              </div>

                              <button
                                type="submit"
                                disabled={actionLoading}
                                className="w-full hand-drawn-button-primary py-3.5 text-sm md:text-base font-black flex items-center justify-center gap-2 cursor-pointer"
                              >
                                <UserPlus className="w-4.5 h-4.5" />
                                <span>締結金盟 · 造冊註冊</span>
                              </button>
                            </form>

                            <button
                              onClick={() => setAuthMode("login")}
                              className="w-full text-center text-xs md:text-sm font-serif font-black text-retro-dark/65 hover:text-retro-vermilion mt-1 cursor-pointer"
                            >
                              已有帳卡？返回登入大堂
                            </button>
                          </motion.div>
                        )}

                        {authMode === "forgot" && (
                          <motion.div
                            key="forgot-form-view"
                            initial={{ opacity: 0, y: 5 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="space-y-5"
                          >
                            <form onSubmit={handlePasswordReset} className="space-y-4">
                              <p className="text-xs md:text-sm font-bold text-retro-dark/75 leading-relaxed">
                                仙驛飛鳥會將密碼重置的指引文書，投遞到您的常用郵件信箱。
                              </p>
                              
                              <div className="relative">
                                <Mail className="w-5 h-5 text-retro-dark/45 absolute left-3.5 top-1/2 transform -translate-y-1/2" />
                                <input
                                  type="email"
                                  value={email}
                                  onChange={(e) => setEmail(e.target.value)}
                                  placeholder="您的電子信箱帳號"
                                  className="w-full hand-drawn-input pl-11 py-3 text-sm md:text-base shadow-inner"
                                  required
                                />
                              </div>

                              <button
                                type="submit"
                                disabled={actionLoading}
                                className="w-full hand-drawn-button-primary py-3.5 text-sm md:text-base font-black flex items-center justify-center gap-2 cursor-pointer"
                              >
                                <Send className="w-4.5 h-4.5" />
                                <span>發送尋印信</span>
                              </button>
                            </form>

                            <button
                              onClick={() => setAuthMode("login")}
                              className="w-full text-center text-xs md:text-sm font-serif font-black text-retro-dark/65 hover:text-retro-vermilion cursor-pointer"
                            >
                              返回登入
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}
                </div>
              </div>
            )}
            
          </AnimatePresence>
        )}
      </main>

      {/* Footer deleted as requested */}

    </div>
  );
}
