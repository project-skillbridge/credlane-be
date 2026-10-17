import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { ADMIN_TIERS_KEY } from '../../../common/decorators/admin-tiers.decorator';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { AdminTier, UserRole } from '../../users/entities/user.entity';
import { AdminSupportController } from './admin-support.controller';
import { AdminSupportService } from './admin-support.service';

describe('AdminSupportController', () => {
  let controller: AdminSupportController;
  let service: {
    findAll: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      findAll: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AdminSupportController],
      providers: [{ provide: AdminSupportService, useValue: service }],
    }).compile();

    controller = moduleRef.get(AdminSupportController);
  });

  it('is gated to admin role plus Super Admin/Admin tiers only', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminSupportController)).toEqual([
      UserRole.ADMIN,
    ]);
    expect(
      Reflect.getMetadata(ADMIN_TIERS_KEY, AdminSupportController),
    ).toEqual([AdminTier.SUPER_ADMIN, AdminTier.ADMIN]);
  });

  it('maps the support ticket routes', () => {
    expect(Reflect.getMetadata(PATH_METADATA, AdminSupportController)).toBe(
      'admin/support',
    );
    expect(Reflect.getMetadata(PATH_METADATA, controller.findAll)).toBe(
      'tickets',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, controller.findAll)).toBe(
      RequestMethod.GET,
    );
    expect(Reflect.getMetadata(PATH_METADATA, controller.findOne)).toBe(
      'tickets/:id',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, controller.findOne)).toBe(
      RequestMethod.GET,
    );
    expect(Reflect.getMetadata(PATH_METADATA, controller.update)).toBe(
      'tickets/:id',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, controller.update)).toBe(
      RequestMethod.PATCH,
    );
  });

  it('returns service results for the global response transform', async () => {
    service.findAll.mockResolvedValue({ items: [], total: 0 });

    await expect(controller.findAll({})).resolves.toEqual({
      items: [],
      total: 0,
    });
  });
});
