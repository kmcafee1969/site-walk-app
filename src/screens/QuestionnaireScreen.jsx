import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { StorageService } from '../services/StorageService';
import SharePointService from '../services/SharePointService';
import { sharepointConfig } from '../config/sharepoint.config';
import { SyncService } from '../services/SyncService';
import EmailService from '../services/EmailService';
import * as XLSX from 'xlsx';

function QuestionnaireScreen() {
    const { siteId } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const [site, setSite] = useState(null);
    const [loading, setLoading] = useState(true);
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0, status: '' });
    const [errors, setErrors] = useState({});

    // Form state
    const [formData, setFormData] = useState({
        walkedBy: '',
        dateWalked: new Date().toISOString().split('T')[0],
        checkedIn: '',
        checkedOut: '',
        towerOwner: '',
        faNumber: '',
        pocName: '',
        pocPhone: '',
        pocEmail: '',
        towerType: '',
        leaseAreaType: '',
        powerCompany: '',
        meterNumber: '',
        telcoFiberProvider: '',
        telcoFiberPOC: '',
        measurement1: '',
        measurement2: '',
        measurement3: '',
        measurement4: '',
        measurement5: '',
        measurement6: '',
        measurement7: '',
        measurement8: '',
        measurement9: '',
        measurement10: '',
        measurement11: '',
        leaseAreaIssues: '',
        gateShelterCode: ''
    });

    // N/A checkboxes
    const [naChecked, setNaChecked] = useState({
        measurement1: false,
        measurement2: false,
        measurement3: false,
        measurement4: false,
        measurement5: false,
        measurement6: false,
        measurement7: false,
        measurement8: false,
        measurement9: false,
        measurement10: false,
        measurement11: false,
        leaseAreaIssues: false,
        gateShelterCode: false
    });

    // Load site data and questionnaire
    useEffect(() => {
        const loadData = async () => {
            try {
                // 1. Load Site
                const sites = await StorageService.getSites();
                const foundSite = sites.find(s => s.id === siteId);
                if (foundSite) {
                    setSite(foundSite);

                    // Default values from site info
                    let initialData = {
                        towerOwner: foundSite.towerOwner || '',
                        powerCompany: foundSite.powerCompany || '',
                        meterNumber: foundSite.meterNumber || '',
                        telcoFiberProvider: foundSite.telcoProvider || '',
                        leaseAreaType: foundSite.leaseAreaType || '',
                        gateShelterCode: foundSite.gateCode || ''
                    };

                    // 2. Load Saved Questionnaire (Local)
                    const savedQuestionnaire = await StorageService.getQuestionnaire(siteId);
                    if (savedQuestionnaire && savedQuestionnaire.data) {
                        console.log("Loaded saved questionnaire:", savedQuestionnaire.data);
                        initialData = { ...initialData, ...savedQuestionnaire.data };
                    }

                    // 3. Load Remote Questionnaire (if requested)
                    if (location.state?.loadFromCloud) {
                        try {
                            console.log("Loading remote questionnaire...");
                            const remoteData = await SharePointService.downloadQuestionnaire(foundSite.phase, foundSite.name, foundSite.id);
                            if (remoteData) {
                                console.log("Loaded remote data:", remoteData);
                                initialData = { ...initialData, ...remoteData };

                                // Save merged data locally so we have it next time
                                await StorageService.saveQuestionnaire(siteId, initialData, 'synced');
                            }
                        } catch (err) {
                            console.error("Failed to load remote questionnaire:", err);
                            // We purposefully don't block loading if remote fails, just log it.
                            // Maybe show a toast/alert? For now, console error.
                        }
                    }

                    // 4. Update N/A checkboxes based on FINAL data
                    const newNaChecked = { ...naChecked };
                    Object.keys(newNaChecked).forEach(key => {
                        if (initialData[key] === 'N/A') {
                            newNaChecked[key] = true;
                        } else {
                            // Ensure it's unchecked if we have a real value
                            newNaChecked[key] = false;
                        }
                    });
                    setNaChecked(newNaChecked);

                    setFormData(prev => ({
                        ...prev,
                        ...initialData
                    }));
                }
            } catch (error) {
                console.error('Error loading data:', error);
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, [siteId]);

    const handleInputChange = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        // Clear error when user starts typing
        if (errors[field]) {
            setErrors(prev => ({ ...prev, [field]: null }));
        }
    };

    const handleNaToggle = (field) => {
        setNaChecked(prev => {
            const newState = { ...prev, [field]: !prev[field] };
            // If N/A is checked, set field value to "N/A"
            if (newState[field]) {
                setFormData(prevForm => ({ ...prevForm, [field]: 'N/A' }));
            } else {
                setFormData(prevForm => ({ ...prevForm, [field]: '' }));
            }
            return newState;
        });
        // Clear error when N/A is toggled
        if (errors[field]) {
            setErrors(prev => ({ ...prev, [field]: null }));
        }
    };

    const validateForm = () => {
        const newErrors = {};
        const requiredFields = Object.keys(formData);

        requiredFields.forEach(field => {
            if (!formData[field] || formData[field].trim() === '') {
                newErrors[field] = 'This field is required';
            }
        });

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const generateExcel = () => {
        // Prepare data for Excel
        const data = [
            ['Site Walk Questionnaire'],
            [''],
            ['Site Name', site.name],
            ['Site ID', site.id],
            ['Phase', site.phase],
            [''],
            ['Field', 'Value'],
            ['Walked By', formData.walkedBy],
            ['Date Walked', formData.dateWalked],
            ['Checked In', formData.checkedIn],
            ['Checked Out', formData.checkedOut],
            ['Tower Owner', formData.towerOwner],
            ['FA Number', formData.faNumber],
            ['Viaero POC', `${formData.pocName}, ${formData.pocPhone}, ${formData.pocEmail}`],
            ['Tower Type', formData.towerType],
            ['Lease Area Type', formData.leaseAreaType],
            ['Power Company', formData.powerCompany],
            ['Meter Number', formData.meterNumber],
            ['Telco / Fiber Provider', formData.telcoFiberProvider],
            ['Telco / Fiber POC', formData.telcoFiberPOC],
            ['Measurement 1 (inches) - AC Load Center to DC Power Plant', formData.measurement1],
            ['Measurement 2 (inches) - Ran Rack to DC Power Plant', formData.measurement2],
            ['Measurement 3 (inches) - Ran Rack to Alarm Panel', formData.measurement3],
            ['Measurement 4 (inches) - Ran Rack to Shelter Exit Port', formData.measurement4],
            ['Measurement 5 (inches) - DC Power Plant to Shelter Exit Port', formData.measurement5],
            ['Measurement 6 (inches) - Ran Rack to GPS Arrestor', formData.measurement6],
            ['Measurement 7 (inches) - GPS Arrestor to GPS Antenna', formData.measurement7],
            ['Measurement 8 (inches) - Ran Rack to Shelter MGB', formData.measurement8],
            ['Measurement 9 (inches) - Ice Bridge Post to Tower Face', formData.measurement9],
            ['Measurement 10 (feet) - Carrier RAD Center', formData.measurement10],
            ['Measurement 11 (feet) - Tower Face Width', formData.measurement11],
            ['Lease Area Issues', formData.leaseAreaIssues],
            ['Gate/Shelter Code', formData.gateShelterCode],
            [''],
            ['Generated', new Date().toLocaleString()]
        ];

        const ws = XLSX.utils.aoa_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Site Walk');

        // Set column widths
        ws['!cols'] = [{ wch: 50 }, { wch: 40 }];

        // Generate binary
        const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        return new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    };

    const handleSubmit = async () => {
        if (!validateForm()) {
            alert('Please fill in all required fields.');
            return;
        }

        setShowUploadModal(true);
        setUploadProgress({ current: 0, total: 1, status: 'Generating Excel file...' });

        try {
            const excelBlob = generateExcel();

            setUploadProgress({ current: 0, total: 1, status: 'Uploading to SharePoint...' });

            await SharePointService.uploadQuestionnaire(
                site.phase,
                site.name,
                site.id,
                excelBlob
            );

            const folderPath = `Documents > Telamon - Viaero Site Walks > ${sharepointConfig.sharepoint.normalizePhase(site.phase)} > ${site.name}`;

            setUploadProgress({
                current: 1,
                total: 1,
                status: `✅ Success! Questionnaire uploaded to SharePoint.\n\nLocation: ${folderPath}\n\nSending email notification...`
            });

            // Send email notification
            try {
                await EmailService.sendUploadNotification(site.name, 'questionnaire', 1, { folderPath });
                setUploadProgress(prev => ({
                    ...prev,
                    status: `✅ Success! Questionnaire uploaded to SharePoint.\n\nLocation: ${folderPath}\n\n📧 Email notification sent!`
                }));
            } catch (emailErr) {
                console.error('Email notification failed:', emailErr);
            }

            // Save questionnaire locally
            await StorageService.saveQuestionnaire(site.id, {
                data: formData,
                uploadedAt: new Date().toISOString()
            }, 'synced');

        } catch (error) {
            console.error('Upload error:', error);
            setUploadProgress({
                current: 0,
                total: 1,
                status: `❌ Upload failed: ${error.message}`
            });
        }
    };

    const renderField = (label, field, description = null, hasNa = false, type = 'text', placeholder = '') => {
        const isDisabled = hasNa && naChecked[field];

        return (
            <div style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <label style={{ fontWeight: '500', fontSize: '14px' }}>
                        {label} <span style={{ color: 'red' }}>*</span>
                    </label>
                    {hasNa && (
                        <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={naChecked[field]}
                                onChange={() => handleNaToggle(field)}
                            />
                            N/A
                        </label>
                    )}
                </div>
                {description && (
                    <p style={{ fontSize: '12px', color: '#666', margin: '0 0 4px 0' }}>{description}</p>
                )}
                {type === 'textarea' ? (
                    <textarea
                        value={formData[field]}
                        onChange={(e) => handleInputChange(field, e.target.value)}
                        disabled={isDisabled}
                        placeholder={placeholder}
                        style={{
                            width: '100%',
                            padding: '10px',
                            borderRadius: '6px',
                            border: errors[field] ? '2px solid red' : '1px solid #ddd',
                            fontSize: '14px',
                            minHeight: '80px',
                            backgroundColor: isDisabled ? '#f5f5f5' : 'white'
                        }}
                    />
                ) : (
                    <input
                        type={type}
                        value={formData[field]}
                        onChange={(e) => handleInputChange(field, e.target.value)}
                        disabled={isDisabled}
                        placeholder={placeholder}
                        style={{
                            width: '100%',
                            padding: '10px',
                            borderRadius: '6px',
                            border: errors[field] ? '2px solid red' : '1px solid #ddd',
                            fontSize: '14px',
                            backgroundColor: isDisabled ? '#f5f5f5' : 'white'
                        }}
                    />
                )}
                {errors[field] && (
                    <p style={{ color: 'red', fontSize: '12px', margin: '4px 0 0 0' }}>{errors[field]}</p>
                )}
            </div>
        );
    };

    if (loading) return <div style={{ padding: '20px' }}>Loading Site...</div>;
    if (!site) return <div style={{ padding: '20px' }}>Site not found</div>;

    return (
        <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
            {/* Header */}
            <div className="header">
                <div className="container" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <button
                        onClick={() => navigate(-1)}
                        style={{ background: 'none', border: 'none', color: 'white', fontSize: '24px', cursor: 'pointer' }}
                    >
                        ←
                    </button>
                    <div>
                        <h1 style={{ fontSize: '18px', margin: 0 }}>Site Walk Questionnaire</h1>
                        <p style={{ margin: 0, opacity: 0.9, fontSize: '12px' }}>{site.name} - Site ID: {site.id}</p>
                    </div>
                </div>
            </div>

            <div className="container" style={{ padding: '20px', paddingBottom: '100px' }}>
                {/* Basic Info Section */}
                <div className="card" style={{ marginBottom: '16px' }}>
                    <h3 style={{ marginTop: 0, marginBottom: '16px', borderBottom: '1px solid #eee', paddingBottom: '8px' }}>
                        📋 Basic Information
                    </h3>
                    {renderField('Walked By', 'walkedBy', null, false, 'text', 'Technician name')}
                    {renderField('Date Walked', 'dateWalked', null, false, 'date')}
                    {renderField('Checked In', 'checkedIn', null, false, 'time')}
                    {renderField('Checked Out', 'checkedOut', null, false, 'time')}
                </div>

                {/* Site Details Section */}
                <div className="card" style={{ marginBottom: '16px' }}>
                    <h3 style={{ marginTop: 0, marginBottom: '16px', borderBottom: '1px solid #eee', paddingBottom: '8px' }}>
                        🏗️ Site Details
                    </h3>
                    {renderField('Tower Owner', 'towerOwner')}
                    {renderField('FA Number', 'faNumber', 'Tower Owner Site Number')}
                    {renderField('Tower Type', 'towerType', null, false, 'text', 'e.g., Monopole, Lattice, Guyed')}
                    {renderField('Lease Area Type', 'leaseAreaType', null, false, 'text', 'e.g., Compound, Rooftop')}
                </div>

                {/* Contact Section */}
                <div className="card" style={{ marginBottom: '16px' }}>
                    <h3 style={{ marginTop: 0, marginBottom: '16px', borderBottom: '1px solid #eee', paddingBottom: '8px' }}>
                        📞 Contact Information
                    </h3>
                    {renderField('POC Name', 'pocName')}
                    {renderField('POC Phone', 'pocPhone', null, false, 'tel')}
                    {renderField('POC Email', 'pocEmail', null, false, 'email')}
                </div>

                {/* Utility Section */}
                <div className="card" style={{ marginBottom: '16px' }}>
                    <h3 style={{ marginTop: 0, marginBottom: '16px', borderBottom: '1px solid #eee', paddingBottom: '8px' }}>
                        ⚡ Utility Information
                    </h3>
                    {renderField('Power Company', 'powerCompany')}
                    {renderField('Meter Number', 'meterNumber')}
                    {renderField('Telco / Fiber Provider', 'telcoFiberProvider')}
                    {renderField('Telco / Fiber POC', 'telcoFiberPOC')}
                </div>

                {/* Measurements Section */}
                <div className="card" style={{ marginBottom: '16px' }}>
                    <h3 style={{ marginTop: 0, marginBottom: '16px', borderBottom: '1px solid #eee', paddingBottom: '8px' }}>
                        📏 Measurements
                    </h3>
                    {renderField('Measurement 1 (inches)', 'measurement1',
                        'Horizontal distance from AC Load Center to DC Power Plant (How a conduit would route)', true)}
                    {renderField('Measurement 2 (inches)', 'measurement2',
                        'Horizontal distance from Ran Rack to DC Power Plant along cable tray', true)}
                    {renderField('Measurement 3 (inches)', 'measurement3',
                        'Horizontal distance from Ran Rack to Alarm Panel along cable tray to wall above Alarm Panel J-Box', true)}
                    {renderField('Measurement 4 (inches)', 'measurement4',
                        'Horizontal distance from Ran Rack to Shelter Exit Port', true)}
                    {renderField('Measurement 5 (inches)', 'measurement5',
                        'Horizontal distance from DC Power Plant to Shelter Exit Port', true)}
                    {renderField('Measurement 6 (inches)', 'measurement6',
                        'Horizontal & Vertical distance from Ran Rack to GPS Arrestor (Usually mounted on Shelter MGB)', true)}
                    {renderField('Measurement 7 (inches)', 'measurement7',
                        'Horizontal distance from GPS Arrestor to existing GPS Antenna outdoors (Usually on Ice Bridge post)', true)}
                    {renderField('Measurement 8 (inches)', 'measurement8',
                        'Horizontal distance from Ran Rack to Shelter Master Ground Bar (MGB)', true)}
                    {renderField('Measurement 9 (inches)', 'measurement9',
                        'Horizontal distance from Ice Bridge Post, where proposed OVPs and Unistrut will be installed, to Tower face', true)}
                    {renderField('Measurement 10 (feet)', 'measurement10',
                        'Carrier RAD center', true)}
                    {renderField('Measurement 11 (feet)', 'measurement11',
                        'Tower Face Width', true)}
                </div>

                {/* Additional Info Section */}
                <div className="card" style={{ marginBottom: '16px' }}>
                    <h3 style={{ marginTop: 0, marginBottom: '16px', borderBottom: '1px solid #eee', paddingBottom: '8px' }}>
                        📝 Additional Information
                    </h3>
                    {renderField('Lease Area Issues', 'leaseAreaIssues', null, true, 'textarea', 'Describe any issues with the lease area...')}
                    {renderField('Gate/Shelter Code', 'gateShelterCode', null, true)}
                </div>

                {/* Submit Button */}
                <button
                    onClick={handleSubmit}
                    className="btn btn-primary"
                    style={{
                        width: '100%',
                        padding: '16px',
                        fontSize: '16px',
                        fontWeight: '600'
                    }}
                >
                    💾 Save & Upload to SharePoint
                </button>
            </div>

            {/* Upload Modal */}
            {showUploadModal && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 1000
                }}>
                    <div style={{
                        backgroundColor: 'white',
                        padding: '24px',
                        borderRadius: '12px',
                        maxWidth: '400px',
                        width: '90%'
                    }}>
                        <h3 style={{ marginTop: 0 }}>Uploading to SharePoint</h3>

                        {uploadProgress.current < uploadProgress.total && (
                            <div style={{
                                height: '8px',
                                backgroundColor: '#e0e0e0',
                                borderRadius: '4px',
                                marginBottom: '16px',
                                overflow: 'hidden'
                            }}>
                                <div style={{
                                    height: '100%',
                                    width: '100%',
                                    backgroundColor: '#1976d2',
                                    animation: 'pulse 1.5s infinite'
                                }} />
                            </div>
                        )}

                        <div style={{
                            whiteSpace: 'pre-wrap',
                            fontSize: '14px',
                            marginBottom: '20px',
                            minHeight: '60px'
                        }}>
                            {uploadProgress.status}
                        </div>

                        {(uploadProgress.current === uploadProgress.total || uploadProgress.status.includes('❌')) && (
                            <button
                                onClick={() => {
                                    setShowUploadModal(false);
                                    if (uploadProgress.current === uploadProgress.total && !uploadProgress.status.includes('❌')) {
                                        navigate(-1);
                                    }
                                }}
                                className="btn btn-primary"
                                style={{ width: '100%' }}
                            >
                                Close
                            </button>
                        )}
                    </div>
                </div>
            )}

            <style>{`
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.5; }
                }
            `}</style>
        </div>
    );
}

export default QuestionnaireScreen;
