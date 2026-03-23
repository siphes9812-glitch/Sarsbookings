/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  auth, 
  db 
} from './firebase';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  User as FirebaseUser,
  setPersistence,
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile
} from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  doc, 
  getDocs,
  Timestamp,
  orderBy,
  setDoc,
  getDoc
} from 'firebase/firestore';
import { 
  Mail, 
  Lock, 
  UserPlus,
  Calendar as CalendarIcon, 
  Clock, 
  User as UserIcon, 
  FileText, 
  LogOut, 
  Plus, 
  CheckCircle, 
  XCircle, 
  ChevronRight,
  LayoutDashboard,
  Briefcase,
  Settings,
  Menu,
  X,
  AlertCircle
} from 'lucide-react';
import { format, addDays, startOfDay, isSameDay, parseISO, isAfter } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---

interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: 'client' | 'practitioner' | 'admin';
  specialization?: string;
  bio?: string;
  photoURL?: string;
}

interface Service {
  id: string;
  name: string;
  description: string;
  duration: number;
}

interface Appointment {
  id: string;
  clientId: string;
  practitionerId: string;
  service: string;
  date: Timestamp;
  status: 'pending' | 'confirmed' | 'cancelled';
  notes?: string;
  createdAt: Timestamp;
  clientName?: string;
  practitionerName?: string;
}

// --- Constants ---

const SERVICES: Service[] = [
  { id: 'individual-tax', name: 'individual tax return', description: 'Annual income tax submission for individuals.', duration: 45 },
  { id: 'audit-support', name: 'Tax Audit Support', description: 'Professional assistance during SARS audits.', duration: 90 },
  { id: 'tax-consultation', name: 'General Tax Consultation', description: 'Expert advice on tax planning and compliance.', duration: 30 },
  { id: 'compliance-status', name: 'Tax Complient Tatus', description: 'Assistance in obtaining and maintaining SARS compliance.', duration: 30 },
];

// --- Components ---

const Button = ({ 
  children, 
  onClick, 
  variant = 'primary', 
  className = '', 
  disabled = false,
  type = 'button'
}: { 
  children: React.ReactNode; 
  onClick?: () => void; 
  variant?: 'primary' | 'secondary' | 'outline' | 'danger'; 
  className?: string;
  disabled?: boolean;
  type?: 'button' | 'submit';
}) => {
  const baseStyles = "px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed";
  const variants = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 shadow-sm",
    secondary: "bg-gray-100 text-gray-900 hover:bg-gray-200",
    outline: "border border-gray-300 text-gray-700 hover:bg-gray-50",
    danger: "bg-red-600 text-white hover:bg-red-700 shadow-sm"
  };

  return (
    <button 
      type={type}
      onClick={onClick} 
      className={`${baseStyles} ${variants[variant]} ${className}`}
      disabled={disabled}
    >
      {children}
    </button>
  );
};

const Card = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={`bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden ${className}`}>
    {children}
  </div>
);

const Badge = ({ children, status }: { children: React.ReactNode; status: string }) => {
  const colors: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800",
    confirmed: "bg-green-100 text-green-800",
    cancelled: "bg-red-100 text-red-800",
  };
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-semibold uppercase tracking-wider ${colors[status] || "bg-gray-100 text-gray-800"}`}>
      {children}
    </span>
  );
};

// --- Main App ---

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [practitioners, setPractitioners] = useState<UserProfile[]>([]);
  const [view, setView] = useState<'dashboard' | 'book' | 'profile'>('dashboard');
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');

  // Booking State
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedPractitioner, setSelectedPractitioner] = useState<UserProfile | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [bookingNotes, setBookingNotes] = useState('');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      try {
        setUser(u);
        if (u) {
          // Fetch or create profile
          const profileRef = doc(db, 'users', u.uid);
          const profileSnap = await getDoc(profileRef);
          
          if (profileSnap.exists()) {
            setProfile(profileSnap.data() as UserProfile);
          } else {
            const newProfile: UserProfile = {
              uid: u.uid,
              name: u.displayName || 'Anonymous User',
              email: u.email || '',
              role: 'client',
              photoURL: u.photoURL || undefined
            };
            await setDoc(profileRef, newProfile);
            setProfile(newProfile);
          }
        } else {
          setProfile(null);
        }
      } catch (err) {
        console.error("Auth State Error:", err);
        setError("Failed to load user profile. Please refresh the page.");
      } finally {
        setLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user || !profile) return;

    // Fetch appointments
    const q = profile.role === 'client' 
      ? query(collection(db, 'appointments'), where('clientId', '==', user.uid), orderBy('date', 'desc'))
      : query(collection(db, 'appointments'), where('practitionerId', '==', user.uid), orderBy('date', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const apps = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Appointment));
      setAppointments(apps);
    }, (err) => {
      console.error("Firestore Error:", err);
      setError("Failed to load appointments. Please check permissions.");
    });

    // Fetch practitioners
    const pQuery = query(collection(db, 'users'), where('role', '==', 'practitioner'));
    const pUnsubscribe = onSnapshot(pQuery, (snapshot) => {
      const ps = snapshot.docs.map(doc => doc.data() as UserProfile);
      // Ensure Lizo Mtshengu is always in the list for this specific request
      const hasLizo = ps.some(p => p.email === 'lizomtshengu@gmail.com');
      if (!hasLizo) {
        ps.unshift({
          uid: 'lizo-mtshengu-id',
          name: 'Lizo Mtshengu',
          email: 'lizomtshengu@gmail.com',
          role: 'practitioner',
          specialization: 'Tax Specialist'
        });
      }
      setPractitioners(ps);
    });

    return () => {
      unsubscribe();
      pUnsubscribe();
    };
  }, [user, profile]);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    setError(null);
    try {
      await setPersistence(auth, browserLocalPersistence);
      if (authMode === 'signup') {
        if (!displayName) throw new Error("Please enter your name.");
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(userCredential.user, { displayName });
        
        // Create profile in Firestore
        const profileRef = doc(db, 'users', userCredential.user.uid);
        const newProfile: UserProfile = {
          uid: userCredential.user.uid,
          name: displayName,
          email: email,
          role: 'client'
        };
        await setDoc(profileRef, newProfile);
        setProfile(newProfile);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err: any) {
      console.error("Email Auth Error:", err);
      if (err.code === 'auth/email-already-in-use') {
        setError("This email is already in use. Please log in instead.");
      } else if (err.code === 'auth/weak-password') {
        setError("Password should be at least 6 characters.");
      } else if (err.code === 'auth/invalid-email') {
        setError("Invalid email address.");
      } else if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setError("Invalid email or password.");
      } else {
        setError(err.message || "Failed to authenticate. Please try again.");
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogin = async () => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    setError(null);
    console.log("Starting login process...");
    try {
      auth.useDeviceLanguage();
      await setPersistence(auth, browserLocalPersistence);
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      console.log("Opening popup...");
      const result = await signInWithPopup(auth, provider);
      console.log("Login successful:", result.user.email);
    } catch (err: any) {
      console.error("Login Error Details:", {
        code: err.code,
        message: err.message,
        customData: err.customData,
        email: err.email
      });
      if (err.code === 'auth/popup-blocked') {
        setError("Login popup was blocked by your browser. Please allow popups for this site and try again.");
      } else if (err.code === 'auth/cancelled-popup-request') {
        setError("Login was interrupted. Please try again.");
      } else if (err.code === 'auth/popup-closed-by-user') {
        setError("Login window was closed before completion. Please try again.");
      } else if (err.code === 'auth/unauthorized-domain') {
        setError("This domain is not authorized for Google Sign-In. Please contact support.");
      } else if (err.code === 'auth/internal-error') {
        setError("An internal error occurred. Please try again later.");
      } else if (err.code === 'auth/network-request-failed') {
        setError("Network error. Please check your internet connection.");
      } else {
        setError(`Failed to sign in: ${err.message || "Unknown error"}`);
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => signOut(auth);

  const handleBooking = async () => {
    if (!user || !selectedService || !selectedPractitioner || !selectedDate || !selectedTime) return;

    setError(null);
    try {
      const [hours, minutes] = selectedTime.split(':').map(Number);
      const appointmentDate = new Date(selectedDate);
      appointmentDate.setHours(hours, minutes, 0, 0);

      const appointmentTimestamp = Timestamp.fromDate(appointmentDate);

      // Check availability
      const q = query(
        collection(db, 'appointments'), 
        where('practitionerId', '==', selectedPractitioner.uid),
        where('date', '==', appointmentTimestamp)
      );
      
      const existingDocs = await getDocs(q);
      const isBooked = existingDocs.docs.some(doc => doc.data().status !== 'cancelled');
      
      if (isBooked) {
        setError("This time slot is already booked. Please choose another time or date.");
        return;
      }

      const newAppointment = {
        clientId: user.uid,
        clientName: user.displayName,
        practitionerId: selectedPractitioner.uid,
        practitionerName: selectedPractitioner.name,
        service: selectedService.name,
        date: appointmentTimestamp,
        status: 'pending',
        notes: bookingNotes,
        createdAt: Timestamp.now()
      };

      await addDoc(collection(db, 'appointments'), newAppointment);
      console.log(`Simulating email to: lizomtshengu@gmail.com for appointment:`, newAppointment);
      setSuccessMessage(`Booking confirmed! A confirmation email has been sent to lizomtshengu@gmail.com.`);
      setView('dashboard');
      resetBooking();
    } catch (err) {
      console.error("Booking Error:", err);
      setError("Failed to book appointment. Please try again.");
    }
  };

  const resetBooking = () => {
    setSelectedService(null);
    setSelectedPractitioner(null);
    setSelectedDate(null);
    setSelectedTime(null);
    setBookingNotes('');
  };

  const updateAppointmentStatus = async (id: string, status: 'confirmed' | 'cancelled') => {
    try {
      await updateDoc(doc(db, 'appointments', id), { status });
    } catch (err) {
      console.error("Update Error:", err);
      setError("Failed to update appointment status.");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full text-center space-y-8"
        >
          <div className="space-y-2">
            <div className="mx-auto w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200">
              <Briefcase className="text-white w-8 h-8" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900">ITECH SA</h1>
            <p className="text-gray-500 italic">SARS Practitioner Appointment System</p>
          </div>
          
          <Card className="p-8 space-y-6">
            <div className="space-y-2">
              <h2 className="text-xl font-semibold">
                {authMode === 'login' ? 'Welcome Back' : 'Create Account'}
              </h2>
              <p className="text-sm text-gray-500">
                {authMode === 'login' 
                  ? 'Sign in to manage your tax appointments.' 
                  : 'Join ITECH SA to book your tax consultations.'}
              </p>
            </div>

            {error && (
              <div className="p-3 bg-red-50 border border-red-100 rounded-xl flex items-center gap-3 text-red-600 text-sm text-left">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <p>{error}</p>
              </div>
            )}

            <form onSubmit={handleEmailAuth} className="space-y-4">
              {authMode === 'signup' && (
                <div className="space-y-1 text-left">
                  <label className="text-xs font-semibold text-gray-500 uppercase ml-1">Full Name</label>
                  <div className="relative">
                    <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input 
                      type="text" 
                      required
                      placeholder="John Doe"
                      className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                    />
                  </div>
                </div>
              )}
              <div className="space-y-1 text-left">
                <label className="text-xs font-semibold text-gray-500 uppercase ml-1">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input 
                    type="email" 
                    required
                    placeholder="name@example.com"
                    className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1 text-left">
                <label className="text-xs font-semibold text-gray-500 uppercase ml-1">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input 
                    type="password" 
                    required
                    placeholder="••••••••"
                    className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </div>
              <Button type="submit" className="w-full py-3" disabled={isLoggingIn}>
                {isLoggingIn ? (
                  <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-white"></div>
                ) : (
                  authMode === 'login' ? 'Sign In' : 'Sign Up'
                )}
              </Button>
            </form>

            <div className="relative py-2">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200"></div>
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-white px-2 text-gray-400">Or continue with</span>
              </div>
            </div>

            <Button onClick={handleLogin} variant="outline" className="w-full py-3" disabled={isLoggingIn}>
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5 mr-2" />
              Google
            </Button>

            <div className="pt-2">
              <button 
                onClick={() => {
                  setAuthMode(authMode === 'login' ? 'signup' : 'login');
                  setError(null);
                }}
                className="text-sm text-blue-600 hover:underline font-medium"
              >
                {authMode === 'login' ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
              </button>
            </div>
          </Card>
          
          <p className="text-xs text-gray-400">
            By signing in, you agree to our Terms of Service and Privacy Policy.
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col md:flex-row">
      {/* Sidebar */}
      <aside className="w-full md:w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-6 border-b border-gray-100 flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <Briefcase className="text-white w-5 h-5" />
          </div>
          <span className="font-bold text-xl tracking-tight">ITECH SA</span>
        </div>
        
        <nav className="flex-1 p-4 space-y-2">
          <button 
            onClick={() => setView('dashboard')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${view === 'dashboard' ? 'bg-blue-50 text-blue-600 font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            <LayoutDashboard className="w-5 h-5" />
            Dashboard
          </button>
          {profile?.role === 'client' && (
            <button 
              onClick={() => setView('book')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${view === 'book' ? 'bg-blue-50 text-blue-600 font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              <Plus className="w-5 h-5" />
              Book Appointment
            </button>
          )}
          <button 
            onClick={() => setView('profile')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${view === 'profile' ? 'bg-blue-50 text-blue-600 font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            <UserIcon className="w-5 h-5" />
            My Profile
          </button>
        </nav>

        <div className="p-4 border-t border-gray-100">
          <div className="flex items-center gap-3 px-4 py-3">
            <img src={user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}`} alt="User" className="w-8 h-8 rounded-full" />
            <div className="flex-1 overflow-hidden">
              <p className="text-sm font-medium truncate">{user.displayName}</p>
              <p className="text-xs text-gray-500 truncate capitalize">{profile?.role}</p>
            </div>
            <button onClick={handleLogout} className="text-gray-400 hover:text-red-500 transition-colors">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-5xl mx-auto space-y-8">
          
          {successMessage && (
            <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-xl flex items-center gap-3">
              <CheckCircle className="w-5 h-5" />
              <p className="text-sm">{successMessage}</p>
              <button onClick={() => setSuccessMessage(null)} className="ml-auto text-green-500 hover:text-green-700">
                <X className="w-5 h-5" />
              </button>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl flex items-center gap-3">
              <AlertCircle className="w-5 h-5" />
              <p className="text-sm">{error}</p>
              <button onClick={() => setError(null)} className="ml-auto text-red-500 hover:text-red-700">
                <X className="w-5 h-5" />
              </button>
            </div>
          )}

          {view === 'dashboard' && (
            <div className="space-y-6">
              <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Welcome, {user.displayName?.split(' ')[0]}</h1>
                  <p className="text-gray-500">Manage your tax appointments and upcoming consultations.</p>
                </div>
              </header>

              {profile?.role === 'client' ? (
                <div className="grid grid-cols-1 gap-6">
                  <Card className="p-8 bg-gradient-to-br from-blue-600 to-blue-800 text-white flex flex-col items-center text-center space-y-4">
                    <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-sm">
                      <Plus className="w-8 h-8" />
                    </div>
                    <div className="space-y-2">
                      <h2 className="text-2xl font-bold">Need a Tax Consultation?</h2>
                      <p className="text-blue-100 max-w-md">Book an appointment with one of our SARS practitioners to get expert help with your taxes.</p>
                    </div>
                    <Button 
                      variant="secondary" 
                      className="px-8 py-3 bg-white text-blue-600 hover:bg-blue-50"
                      onClick={() => setView('book')}
                    >
                      Book Appointment Now
                    </Button>
                  </Card>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <Card className="p-6 bg-blue-600 text-white">
                      <p className="text-blue-100 text-sm font-medium">Total Appointments</p>
                      <h3 className="text-3xl font-bold mt-1">{appointments.length}</h3>
                    </Card>
                    <Card className="p-6">
                      <p className="text-gray-500 text-sm font-medium">Confirmed</p>
                      <h3 className="text-3xl font-bold mt-1 text-green-600">
                        {appointments.filter(a => a.status === 'confirmed').length}
                      </h3>
                    </Card>
                    <Card className="p-6">
                      <p className="text-gray-500 text-sm font-medium">Pending</p>
                      <h3 className="text-3xl font-bold mt-1 text-yellow-600">
                        {appointments.filter(a => a.status === 'pending').length}
                      </h3>
                    </Card>
                  </div>

                  <div className="space-y-4">
                    <h2 className="text-lg font-semibold text-gray-900">Recent Appointments</h2>
                    {appointments.length === 0 ? (
                      <Card className="p-12 text-center space-y-4">
                        <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto">
                          <CalendarIcon className="text-gray-300 w-8 h-8" />
                        </div>
                        <p className="text-gray-500">No appointments found.</p>
                      </Card>
                    ) : (
                      <div className="grid grid-cols-1 gap-4">
                        {appointments.map((app) => (
                          <Card key={app.id} className="p-4 md:p-6 flex flex-col md:flex-row md:items-center gap-4 hover:border-blue-200 transition-colors group">
                            <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                              <CalendarIcon className="w-6 h-6" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <h4 className="font-semibold text-gray-900 truncate">{app.service}</h4>
                                <Badge status={app.status}>{app.status}</Badge>
                              </div>
                              <div className="flex flex-wrap gap-4 text-sm text-gray-500">
                                <span className="flex items-center gap-1">
                                  <UserIcon className="w-4 h-4" />
                                  {profile?.role === 'client' ? `Practitioner: ${app.practitionerName}` : `Client: ${app.clientName}`}
                                </span>
                                <span className="flex items-center gap-1">
                                  <Clock className="w-4 h-4" />
                                  {format(app.date.toDate(), 'PPP p')}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {profile?.role === 'practitioner' && app.status === 'pending' && (
                                <>
                                  <Button variant="outline" className="text-green-600 border-green-200 hover:bg-green-50" onClick={() => updateAppointmentStatus(app.id, 'confirmed')}>
                                    <CheckCircle className="w-4 h-4" />
                                    Confirm
                                  </Button>
                                  <Button variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => updateAppointmentStatus(app.id, 'cancelled')}>
                                    <XCircle className="w-4 h-4" />
                                    Cancel
                                  </Button>
                                </>
                              )}
                              {app.status !== 'cancelled' && (
                                <Button variant="outline" className="text-gray-400 hover:text-red-500" onClick={() => updateAppointmentStatus(app.id, 'cancelled')}>
                                  Cancel
                                </Button>
                              )}
                            </div>
                          </Card>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {view === 'book' && (
            <div className="space-y-8">
              <header>
                <h1 className="text-2xl font-bold text-gray-900">Book an Appointment</h1>
                <p className="text-gray-500">Follow the steps to schedule your tax consultation.</p>
              </header>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-8">
                  {/* Step 1: Service */}
                  <section className="space-y-4">
                    <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Step 1: Select Service</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {SERVICES.map((s) => (
                        <button 
                          key={s.id}
                          onClick={() => setSelectedService(s)}
                          className={`text-left p-4 rounded-xl border-2 transition-all ${selectedService?.id === s.id ? 'border-blue-600 bg-blue-50' : 'border-gray-100 hover:border-gray-200 bg-white'}`}
                        >
                          <h4 className="font-bold text-gray-900">{s.name}</h4>
                          <p className="text-xs text-gray-500 mt-1">{s.description}</p>
                          <p className="text-xs font-medium text-blue-600 mt-2">{s.duration} mins</p>
                        </button>
                      ))}
                    </div>
                  </section>

                  {/* Step 2: Choose Practitioner */}
                  <section className="space-y-4">
                    <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Step 2: Choose Practitioner</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {practitioners.map((p) => (
                        <button 
                          key={p.uid}
                          onClick={() => setSelectedPractitioner(p)}
                          className={`flex items-center gap-4 p-4 rounded-xl border-2 transition-all ${selectedPractitioner?.uid === p.uid ? 'border-blue-600 bg-blue-50' : 'border-gray-100 hover:border-gray-200 bg-white'}`}
                        >
                          <img src={p.photoURL || `https://ui-avatars.com/api/?name=${p.name}`} alt={p.name} className="w-12 h-12 rounded-full" />
                          <div className="text-left">
                            <h4 className="font-bold text-gray-900">{p.name}</h4>
                            <p className="text-xs text-gray-500">{p.specialization || 'Tax Specialist'}{p.email === 'lizomtshengu@gmail.com' ? ' (lizomtshengu@gmail.com)' : ''}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </section>

                  {/* Step 3: Date & Time */}
                  <section className="space-y-4">
                    <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Step 3: Date & Time</h3>
                    <div className="bg-white p-6 rounded-xl border border-gray-100 space-y-6">
                      <div className="grid grid-cols-4 md:grid-cols-7 gap-2">
                        {[...Array(14)].map((_, i) => {
                          const date = addDays(startOfDay(new Date()), i + 1);
                          const isSelected = selectedDate && isSameDay(date, selectedDate);
                          return (
                            <button
                              key={i}
                              onClick={() => setSelectedDate(date)}
                              className={`flex flex-col items-center p-2 rounded-lg transition-all ${isSelected ? 'bg-blue-600 text-white' : 'hover:bg-gray-100 text-gray-600'}`}
                            >
                              <span className="text-[10px] uppercase font-bold">{format(date, 'EEE')}</span>
                              <span className="text-lg font-bold">{format(date, 'd')}</span>
                            </button>
                          );
                        })}
                      </div>

                      {selectedDate && (
                        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                          {['09:00', '10:00', '11:00', '12:00', '14:00', '15:00', '16:00'].map((time) => (
                            <button
                              key={time}
                              onClick={() => setSelectedTime(time)}
                              className={`py-2 rounded-lg border text-sm font-medium transition-all ${selectedTime === time ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-200 hover:border-blue-200 text-gray-600'}`}
                            >
                              {time}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </section>

                  {/* Step 4: Notes */}
                  <section className="space-y-4">
                    <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Step 4: Additional Notes</h3>
                    <textarea 
                      value={bookingNotes}
                      onChange={(e) => setBookingNotes(e.target.value)}
                      placeholder="e.g. Please bring my previous year's tax certificates..."
                      className="w-full p-4 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none min-h-[100px]"
                    />
                  </section>
                </div>

                {/* Summary Sidebar */}
                <div className="lg:col-span-1">
                  <div className="sticky top-8 space-y-6">
                    <Card className="p-6 space-y-6">
                      <h3 className="font-bold text-lg">Booking Summary</h3>
                      <div className="space-y-4">
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-500">Service</span>
                          <span className="font-medium">{selectedService?.name || 'Not selected'}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-500">Practitioner</span>
                          <span className="font-medium">{selectedPractitioner?.name || 'Not selected'}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-500">Date</span>
                          <span className="font-medium">{selectedDate ? format(selectedDate, 'PPP') : 'Not selected'}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-500">Time</span>
                          <span className="font-medium">{selectedTime || 'Not selected'}</span>
                        </div>
                      </div>
                      <div className="pt-6 border-t border-gray-100">
                        <Button 
                          className="w-full py-4" 
                          disabled={!selectedService || !selectedPractitioner || !selectedDate || !selectedTime}
                          onClick={handleBooking}
                        >
                          Confirm Booking
                        </Button>
                      </div>
                    </Card>
                    <div className="flex items-center gap-2 text-xs text-gray-400 px-2">
                      <AlertCircle className="w-4 h-4" />
                      <p>Your booking will be reviewed by the practitioner.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {view === 'profile' && (
            <div className="space-y-8">
              <header>
                <h1 className="text-2xl font-bold text-gray-900">My Profile</h1>
                <p className="text-gray-500">Manage your account settings and professional information.</p>
              </header>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <Card className="p-8 text-center space-y-4">
                  <div className="relative inline-block">
                    <img src={user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}`} alt="User" className="w-24 h-24 rounded-full mx-auto border-4 border-white shadow-md" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold">{user.displayName}</h3>
                    <p className="text-gray-500 text-sm">{user.email}</p>
                  </div>
                  <Badge status="confirmed">{profile?.role}</Badge>
                </Card>

                <Card className="md:col-span-2 p-8 space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-gray-500">Full Name</label>
                      <input 
                        type="text" 
                        value={profile?.name || ''} 
                        disabled
                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg text-gray-600"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-gray-500">Email Address</label>
                      <input 
                        type="email" 
                        value={profile?.email || ''} 
                        disabled
                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg text-gray-600"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-gray-500">Account Role</label>
                      <select 
                        value={profile?.role || 'client'} 
                        onChange={async (e) => {
                          const newRole = e.target.value as 'client' | 'practitioner';
                          if (profile) {
                            const updated = { ...profile, role: newRole };
                            await updateDoc(doc(db, 'users', user.uid), { role: newRole });
                            setProfile(updated);
                          }
                        }}
                        className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                      >
                        <option value="client">Client</option>
                        <option value="practitioner">SARS Practitioner</option>
                      </select>
                    </div>
                    {profile?.role === 'practitioner' && (
                      <div className="space-y-2">
                        <label className="text-sm font-semibold text-gray-500">Specialization</label>
                        <input 
                          type="text" 
                          placeholder="e.g. Corporate Tax, VAT Specialist"
                          value={profile?.specialization || ''} 
                          onChange={async (e) => {
                            const spec = e.target.value;
                            if (profile) {
                              const updated = { ...profile, specialization: spec };
                              await updateDoc(doc(db, 'users', user.uid), { specialization: spec });
                              setProfile(updated);
                            }
                          }}
                          className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                      </div>
                    )}
                  </div>
                  {profile?.role === 'practitioner' && (
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-gray-500">Professional Bio</label>
                      <textarea 
                        value={profile?.bio || ''} 
                        onChange={async (e) => {
                          const bio = e.target.value;
                          if (profile) {
                            const updated = { ...profile, bio };
                            await updateDoc(doc(db, 'users', user.uid), { bio });
                            setProfile(updated);
                          }
                        }}
                        placeholder="Tell clients about your experience..."
                        className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none min-h-[100px]"
                      />
                    </div>
                  )}
                </Card>
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
