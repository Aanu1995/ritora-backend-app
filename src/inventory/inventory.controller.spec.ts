import { BadRequestException } from '@nestjs/common';
import type { UploadedCatalogueImage } from '../catalogue/catalogue-photo.types';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

const mockInventoryService = () => ({
  getStats: jest.fn(),
  list: jest.fn(),
  create: jest.fn(),
  uploadProductImage: jest.fn(),
  archiveMany: jest.fn(),
  restoreMany: jest.fn(),
  markFinishedMany: jest.fn(),
  removeMany: jest.fn(),
  getOne: jest.fn(),
  update: jest.fn(),
  archive: jest.fn(),
  restore: jest.fn(),
  markFinished: jest.fn(),
  remove: jest.fn(),
});

describe('InventoryController', () => {
  let controller: InventoryController;
  let inventoryService: ReturnType<typeof mockInventoryService>;

  beforeEach(() => {
    inventoryService = mockInventoryService();
    controller = new InventoryController(
      inventoryService as unknown as InventoryService,
    );
  });

  it('forwards stats, list, and create requests to the service', async () => {
    const stats = { all: 2, active: 1 };
    const list = { items: [], nextCursor: null };
    const created = { id: 'product-1' };
    const query = { search: 'serum' };
    const draft = { identity: { brand: 'CeraVe', name: 'Serum' } };
    inventoryService.getStats.mockReturnValue(stats);
    inventoryService.list.mockReturnValue(list);
    inventoryService.create.mockResolvedValue(created);

    expect(controller.getStats('user-1', 'Europe/Stockholm', 'UTC')).toBe(
      stats,
    );
    expect(controller.list('user-1', null, 'UTC', query as never)).toBe(list);
    await expect(controller.create('user-1', draft as never)).resolves.toBe(
      created,
    );

    expect(inventoryService.getStats).toHaveBeenCalledWith(
      'user-1',
      'Europe/Stockholm',
      'UTC',
    );
    expect(inventoryService.list).toHaveBeenCalledWith(
      'user-1',
      query,
      null,
      'UTC',
    );
    expect(inventoryService.create).toHaveBeenCalledWith('user-1', draft);
  });

  it('uploads product images and rejects missing files', async () => {
    const file = {
      originalname: 'product.jpg',
      mimetype: 'image/jpeg',
      size: 10,
      buffer: Buffer.from('image'),
    } as UploadedCatalogueImage;
    inventoryService.uploadProductImage.mockResolvedValue(
      'https://cdn.example.com/product.webp',
    );

    await expect(controller.uploadImage('user-1', file)).resolves.toEqual({
      imageUrl: 'https://cdn.example.com/product.webp',
    });
    await expect(controller.uploadImage('user-1', undefined)).rejects.toThrow(
      BadRequestException,
    );
    expect(inventoryService.uploadProductImage).toHaveBeenCalledWith(file);
  });

  it('forwards bulk actions to the service', async () => {
    const dto = { ids: ['product-1', 'product-2'] };
    inventoryService.archiveMany.mockResolvedValue(undefined);
    inventoryService.restoreMany.mockResolvedValue(undefined);
    inventoryService.markFinishedMany.mockResolvedValue(undefined);
    inventoryService.removeMany.mockResolvedValue(undefined);

    await controller.archiveMany('user-1', dto);
    await controller.restoreMany('user-1', dto);
    await controller.markFinishedMany('user-1', dto);
    await controller.removeMany('user-1', dto);

    expect(inventoryService.archiveMany).toHaveBeenCalledWith(
      'user-1',
      dto.ids,
    );
    expect(inventoryService.restoreMany).toHaveBeenCalledWith(
      'user-1',
      dto.ids,
    );
    expect(inventoryService.markFinishedMany).toHaveBeenCalledWith(
      'user-1',
      dto.ids,
    );
    expect(inventoryService.removeMany).toHaveBeenCalledWith('user-1', dto.ids);
  });

  it('forwards single-product reads and mutations to the service', async () => {
    const product = { id: 'product-1' };
    const updateDto = { status: 'active' };
    inventoryService.getOne.mockResolvedValue(product);
    inventoryService.update.mockResolvedValue(product);
    inventoryService.archive.mockResolvedValue(product);
    inventoryService.restore.mockResolvedValue(product);
    inventoryService.markFinished.mockResolvedValue(product);
    inventoryService.remove.mockResolvedValue(undefined);

    await expect(controller.getOne('user-1', 'product-1')).resolves.toBe(
      product,
    );
    await expect(
      controller.update('user-1', 'product-1', updateDto as never),
    ).resolves.toBe(product);
    await expect(controller.archive('user-1', 'product-1')).resolves.toBe(
      product,
    );
    await expect(controller.restore('user-1', 'product-1')).resolves.toBe(
      product,
    );
    await expect(controller.markFinished('user-1', 'product-1')).resolves.toBe(
      product,
    );
    await expect(controller.remove('user-1', 'product-1')).resolves.toBe(
      undefined,
    );

    expect(inventoryService.getOne).toHaveBeenCalledWith('user-1', 'product-1');
    expect(inventoryService.update).toHaveBeenCalledWith(
      'user-1',
      'product-1',
      updateDto,
    );
    expect(inventoryService.archive).toHaveBeenCalledWith(
      'user-1',
      'product-1',
    );
    expect(inventoryService.restore).toHaveBeenCalledWith(
      'user-1',
      'product-1',
    );
    expect(inventoryService.markFinished).toHaveBeenCalledWith(
      'user-1',
      'product-1',
    );
    expect(inventoryService.remove).toHaveBeenCalledWith('user-1', 'product-1');
  });
});
