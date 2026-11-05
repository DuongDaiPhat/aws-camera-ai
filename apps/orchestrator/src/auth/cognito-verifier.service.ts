import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CognitoJwtVerifier } from 'aws-jwt-verify';

@Injectable()
export class CognitoVerifierService {
  private readonly jwtVerifier: ReturnType<typeof CognitoJwtVerifier.create>;

  constructor(private readonly config: ConfigService) {
    this.jwtVerifier = CognitoJwtVerifier.create({
      userPoolId: this.config.getOrThrow<string>('COGNITO_USER_POOL_ID'),
      tokenUse: 'access', // BẮT BUỘC: chỉ chấp nhận access token
      clientId: this.config.getOrThrow<string>('COGNITO_CLIENT_ID'),
      scope: 'openid',
    });
  }

  async verifyAccessToken(token: string) {
    try {
      // Tự động kiểm tra: signature, exp, iss, token_use=access, client_id
      return await this.jwtVerifier.verify(token);
    } catch {
      throw new UnauthorizedException({
        error: {
          code: 'INVALID_TOKEN',
          message: 'Access token Cognito không hợp lệ hoặc đã hết hạn.',
        },
      });
    }
  }
}
