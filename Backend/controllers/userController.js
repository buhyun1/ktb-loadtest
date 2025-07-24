const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { upload } = require('../middleware/upload');
const path = require('path');
const fs = require('fs').promises;
const s3Service = require('../services/s3Service');

// 회원가입 처리 함수
exports.register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // 입력값 유효성 검사
    const validationErrors = [];
    
    // 이름 검증
    if (!name || name.trim().length === 0) {
      validationErrors.push({
        field: 'name',
        message: '이름을 입력해주세요.'
      });
    } else if (name.length < 2) {
      validationErrors.push({
        field: 'name',
        message: '이름은 2자 이상이어야 합니다.'
      });
    }

    // 이메일 검증
    if (!email) {
      validationErrors.push({
        field: 'email',
        message: '이메일을 입력해주세요.'
      });
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      validationErrors.push({
        field: 'email',
        message: '올바른 이메일 형식이 아닙니다.'
      });
    }

    // 비밀번호 검증
    if (!password) {
      validationErrors.push({
        field: 'password',
        message: '비밀번호를 입력해주세요.'
      });
    } else if (password.length < 6) {
      validationErrors.push({
        field: 'password',
        message: '비밀번호는 6자 이상이어야 합니다.'
      });
    }

    // 유효성 검사 실패 시 에러 반환
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        errors: validationErrors
      });
    }

    // 이메일 중복 확인
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: '이미 가입된 이메일입니다.'
      });
    }

    // 새로운 사용자 객체 생성
    const newUser = new User({ 
      name, 
      email, 
      password,
      profileImage: '' // 기본 프로필 이미지 없음
    });

    // 비밀번호 암호화 및 사용자 저장
    const salt = await bcrypt.genSalt(10);
    newUser.password = await bcrypt.hash(password, salt);
    await newUser.save();

    // 성공 응답 반환
    res.status(201).json({
      success: true,
      message: '회원가입이 완료되었습니다.',
      user: {
        id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        profileImage: newUser.profileImage
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: '회원가입 처리 중 오류가 발생했습니다.'
    });
  }
};

// 사용자 프로필 조회 함수
exports.getProfile = async (req, res) => {
  try {
    // 비밀번호를 제외한 사용자 정보 조회
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '사용자를 찾을 수 없습니다.'
      });
    }

    // 프로필 정보 반환
    res.json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        profileImage: user.profileImage
      }
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: '프로필 조회 중 오류가 발생했습니다.'
    });
  }
};

// 프로필 정보 업데이트 함수
exports.updateProfile = async (req, res) => {
  console.log('[updateProfile] called', { userId: req.user.id, body: req.body });
  try {
    const { name } = req.body;

    if (!name || name.trim().length === 0) {
      console.warn('[updateProfile] name missing or empty', { name });
      return res.status(400).json({
        success: false,
        message: '이름을 입력해주세요.'
      });
    }

    const user = await User.findById(req.user.id);
    console.log('[updateProfile] loaded user', user);
    if (!user) {
      console.warn('[updateProfile] user not found', { userId: req.user.id });
      return res.status(404).json({
        success: false,
        message: '사용자를 찾을 수 없습니다.'
      });
    }

    await user.updateProfile({ name: name.trim() });
    console.log('[updateProfile] user updated', { userId: user._id, name: name.trim() });

    res.json({
      success: true,
      message: '프로필이 업데이트되었습니다.',
      user: {
        id: user._id,
        name: name.trim(),
        email: user.email,
        profileImage: user.profileImage
      }
    });

  } catch (error) {
    console.error('[updateProfile] error', error);
    res.status(500).json({
      success: false,
      message: '프로필 업데이트 중 오류가 발생했습니다.'
    });
  }
};

// 프로필 이미지 업로드 함수
exports.uploadProfileImage = async (req, res) => {
  console.log('uploadProfileImage 함수 진입');
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: '이미지가 제공되지 않았습니다.'
      });
    }

    const fileSize = req.file.size;
    const fileType = req.file.mimetype;
    const maxSize = 5 * 1024 * 1024; // 5MB

    if (fileSize > maxSize) {
      return res.status(400).json({
        success: false,
        message: '파일 크기는 5MB를 초과할 수 없습니다.'
      });
    }

    if (!fileType.startsWith('image/')) {
      return res.status(400).json({
        success: false,
        message: '이미지 파일만 업로드할 수 있습니다.'
      });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '사용자를 찾을 수 없습니다.'
      });
    }

    // 기존 프로필 이미지가 S3에 있다면 삭제
    if (user.profileImage && user.profileImage.startsWith('https://')) {
      try {
        const oldKey = user.profileImage.split('/').pop();
        await s3Service.deleteFile(oldKey);
      } catch (error) {
        console.error('Old profile image S3 delete error:', error);
      }
    }

    // S3에 업로드
    const ext = path.extname(req.file.originalname).toLowerCase();
    const safeFilename = `${Date.now()}_${Math.random().toString(36).substring(2, 10)}${ext}`;
    const s3Url = await s3Service.uploadFile(req.file.buffer, safeFilename, req.file.mimetype);
    await user.updateProfile({ profileImage: s3Url });

    res.json({
      success: true,
      message: '프로필 이미지가 업데이트되었습니다.',
      imageUrl: s3Url
    });
  } catch (error) {
    console.error('Profile image upload error:', error);
    res.status(500).json({
      success: false,
      message: '이미지 업로드 중 오류가 발생했습니다.'
    });
  }
};

// 프로필 이미지 삭제 함수
exports.deleteProfileImage = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '사용자를 찾을 수 없습니다.'
      });
    }

    // 기존 프로필 이미지가 S3에 있다면 삭제
    if (user.profileImage && user.profileImage.startsWith('https://')) {
      try {
        const key = user.profileImage.split('/').pop();
        await s3Service.deleteFile(key);
      } catch (error) {
        console.error('Profile image S3 delete error:', error);
      }
      user.profileImage = '';
      await user.save();
    }

    res.json({
      success: true,
      message: '프로필 이미지가 삭제되었습니다.'
    });
  } catch (error) {
    console.error('Delete profile image error:', error);
    res.status(500).json({
      success: false,
      message: '프로필 이미지 삭제 중 오류가 발생했습니다.'
    });
  }
};

// 회원 탈퇴 처리 함수
exports.deleteAccount = async (req, res) => {
  try {
    // 사용자 조회
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '사용자를 찾을 수 없습니다.'
      });
    }

    // 프로필 이미지가 있다면 S3에서 삭제
    if (user.profileImage && user.profileImage.startsWith('https://')) {
      try {
        const key = user.profileImage.split('/').pop();
        await s3Service.deleteFile(key);
      } catch (error) {
        console.error('Profile image S3 delete error:', error);
      }
    }

    // DB에서 사용자 정보 삭제
    await user.deleteOne();

    res.json({
      success: true,
      message: '회원 탈퇴가 완료되었습니다.'
    });

  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({
      success: false,
      message: '회원 탈퇴 처리 중 오류가 발생했습니다.'
    });
  }
};

module.exports = exports;