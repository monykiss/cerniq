import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { AuthGuard } from '../auth/auth.guard';
import { UpdateMemberRoleDto } from '../alm/dto/inline-bodies.dto';

@Controller('api/organizations')
@UseGuards(AuthGuard)
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  create(
    @Body() createDto: { name: string; slug: string; description?: string },
    @Req() req: any,
  ) {
    return this.organizationsService.create(createDto, req.user.userId);
  }

  @Get()
  findAll(@Req() req: any) {
    return this.organizationsService.findAll(req.user.userId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.organizationsService.findOne(id, req.user.userId);
  }

  @Post(':id/members')
  addMember(
    @Param('id') id: string,
    @Body() addMemberDto: { userId: string; role: string },
    @Req() req: any,
  ) {
    return this.organizationsService.addMember(
      id,
      addMemberDto as any,
      req.user.userId,
    );
  }

  @Delete(':id/members/:userId')
  removeMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Req() req: any,
  ) {
    return this.organizationsService.removeMember(id, userId, req.user.userId);
  }

  @Patch(':id/members/:userId/role')
  updateMemberRole(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() body: UpdateMemberRoleDto,
    @Req() req: any,
  ) {
    return this.organizationsService.updateMemberRole(
      id,
      userId,
      body.role as any,
      req.user.userId,
    );
  }
}
