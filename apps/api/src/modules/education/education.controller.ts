import {
    Controller, Get, Post, Put, Delete, Param, Body, Query,
    UseGuards, HttpCode, HttpStatus, BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { EducationService } from './education.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('education')
@Controller('education')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class EducationController {
    constructor(
        private readonly service: EducationService,
        private readonly prisma: PrismaService,
    ) {}

    // Courses
    @Get(':tenantId/courses')
    async listCourses(
        @Param('tenantId') tenantId: string,
        @Query('subject') subject?: string,
        @Query('level') level?: string,
        @Query('modality') modality?: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.listCourses(schemaName, { subject, level, modality });
        return { success: true, data };
    }

    @Get(':tenantId/courses/:id')
    async getCourse(@Param('tenantId') tenantId: string, @Param('id') id: string) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.getCourseById(schemaName, id);
        if (!data) throw new BadRequestException('Course not found');
        return { success: true, data };
    }

    @Post(':tenantId/courses')
    async createCourse(@Param('tenantId') tenantId: string, @Body() body: any) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.createCourse(schemaName, body);
        return { success: true, data };
    }

    @Put(':tenantId/courses/:id')
    @Roles('tenant_admin', 'tenant_supervisor')
    async updateCourse(@Param('tenantId') tenantId: string, @Param('id') id: string, @Body() body: any) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.updateCourse(schemaName, id, body);
        return { success: true, data };
    }

    @Delete(':tenantId/courses/:id')
    @HttpCode(HttpStatus.OK)
    async deleteCourse(@Param('tenantId') tenantId: string, @Param('id') id: string) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.service.deleteCourse(schemaName, id);
        return { success: true };
    }

    // Cohorts
    @Get(':tenantId/cohorts')
    async listCohorts(
        @Param('tenantId') tenantId: string,
        @Query('courseId') courseId?: string,
        @Query('status') status?: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.listCohorts(schemaName, { courseId, status });
        return { success: true, data };
    }

    @Post(':tenantId/cohorts')
    async createCohort(@Param('tenantId') tenantId: string, @Body() body: any) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.createCohort(schemaName, body);
        return { success: true, data };
    }

    @Post(':tenantId/cohorts/:id/cancel')
    async cancelCohort(@Param('tenantId') tenantId: string, @Param('id') id: string) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.cancelCohort(schemaName, id);
        return { success: true, data };
    }

    // Enrollments
    @Get(':tenantId/enrollments')
    async listEnrollments(
        @Param('tenantId') tenantId: string,
        @Query('cohortId') cohortId?: string,
        @Query('contactId') contactId?: string,
        @Query('status') status?: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.listEnrollments(schemaName, { cohortId, contactId, status });
        return { success: true, data };
    }

    @Post(':tenantId/enrollments')
    async createEnrollment(@Param('tenantId') tenantId: string, @Body() body: any) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.enrollStudent(schemaName, body);
        return { success: true, data };
    }

    @Put(':tenantId/enrollments/:id')
    async updateEnrollment(
        @Param('tenantId') tenantId: string,
        @Param('id') id: string,
        @Body() body: any,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.updateEnrollment(schemaName, id, body);
        return { success: true, data };
    }
}
